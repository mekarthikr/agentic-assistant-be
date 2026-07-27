import { Router, type Request, type Response } from "express";

import {
  env,
  groqConfiguration,
  serviceContainer,
} from "@app/config";
import { GroqProvider } from "@app/providers";
import { AIOrchestrator, ConversationService } from "@app/service";
import type { ChatHistoryMessage, Message, MessageRole } from "@app/types";

const router = Router();
const roles = new Set<MessageRole>(["system", "user", "assistant"]);
const conversationService = serviceContainer.get(ConversationService);
const provider = new GroqProvider(groqConfiguration);
const orchestrator = new AIOrchestrator(conversationService, provider);

const parseMessages = (body: unknown): Message[] | null => {
  if (!body || typeof body !== "object" || !("messages" in body)) return null;

  const messages = (body as { messages?: unknown }).messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > env.CHAT_MAX_HISTORY_MESSAGES
  ) {
    return null;
  }

  const parsed: Message[] = [];
  for (const candidate of messages as ChatHistoryMessage[]) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !roles.has(candidate.role) ||
      typeof candidate.content !== "string"
    ) {
      return null;
    }

    const content = candidate.content.trim();
    if (!content || content.length > env.CHAT_MAX_MESSAGE_LENGTH) return null;
    parsed.push({ role: candidate.role, content, createdAt: new Date() });
  }

  return parsed;
};

router.post("/", async (req: Request, res: Response): Promise<void> => {
  const messages = parseMessages(req.body);
  if (!messages) {
    res.status(400).json({
      success: false,
      message: `messages must contain 1-${env.CHAT_MAX_HISTORY_MESSAGES} valid chat messages; each message is limited to ${env.CHAT_MAX_MESSAGE_LENGTH} characters.`,
    });
    return;
  }

  const abortController = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) {
      abortController.abort(new Error("The client disconnected."));
    }
  });

  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.flushHeaders();

  try {
    for await (const delta of orchestrator.streamHistory(messages, {
      signal: abortController.signal,
    })) {
      res.write(delta);
    }
    res.end();
  } catch (error) {
    if (abortController.signal.aborted) return;
    console.error("Chat request failed:", error);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        message: "Unable to process the chat message.",
      });
      return;
    }
    res.destroy(error instanceof Error ? error : undefined);
  }
});

export default router;
