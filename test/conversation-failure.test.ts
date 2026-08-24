import assert from "node:assert/strict";
import test from "node:test";

import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { ConversationService } from "../src/service/conversation.service";
import { ToolRegistry } from "../src/service/tool-registry.service";
import type { LLMProvider, LLMRequest, LLMResponse } from "../src/types";

class FailOnceProvider implements LLMProvider {
  public readonly modelInfo = { model: "fake", contextWindow: 1_000 };
  public readonly calls: LLMRequest[] = [];
  private shouldFail = true;

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    this.calls.push(request);

    if (this.shouldFail) {
      this.shouldFail = false;
      throw new Error("Generation failed.");
    }

    return {
      text: "Only the new question was answered.",
      toolCalls: [],
      assistantMessage: {
        role: "assistant",
        content: "Only the new question was answered.",
      },
      usage: { inputTokens: 6, outputTokens: 6, totalTokens: 12 },
      remainingTokens: null,
    };
  }

  public async *stream(): AsyncIterable<string> {
    yield "Only the new question was answered.";
  }
}

test("excludes a failed user turn from the next generation request", async () => {
  const conversations = new ConversationService();
  const provider = new FailOnceProvider();
  const orchestrator = new AIOrchestrator(
    conversations,
    provider,
    new ToolRegistry([]),
  );

  await assert.rejects(
    orchestrator.chat("failed-turn", "Explain insurance concept alpha."),
    /could not generate a response/i,
  );
  assert.deepEqual(conversations.getConversation("failed-turn").messages, []);

  assert.equal(
    await orchestrator.chat(
      "failed-turn",
      "Explain the new insurance concept beta.",
    ),
    "Only the new question was answered.",
  );
  assert.deepEqual(provider.calls[1]?.messages, [
    { role: "user", content: "Explain the new insurance concept beta." },
  ]);
  assert.deepEqual(
    conversations
      .getConversation("failed-turn")
      .messages.map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Explain the new insurance concept beta." },
      { role: "assistant", content: "Only the new question was answered." },
    ],
  );
});
