import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";
import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { ConversationService } from "../src/service/conversation.service";
import { ToolRegistry } from "../src/service/tool-registry.service";
import type { LLMProvider, LLMRequest, LLMResponse } from "../src/types";

class CapturingProvider implements LLMProvider {
  public messages: readonly ModelMessage[] = [];

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    this.messages = request.messages;
    return {
      text: "Contract lookup ready.",
      toolCalls: [],
      assistantMessage: {
        role: "assistant",
        content: "Contract lookup ready.",
      },
    };
  }

  public async *stream(): AsyncGenerator<string> {
    yield "unused";
  }
}

test("adds insurance scope and retrieved API context as a system message", async () => {
  const provider = new CapturingProvider();
  const rag = new ApiDocumentationRag(`## Contracts API

GET /contracts/:contractNumber returns one insurance contract.`);
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    rag,
  );

  await orchestrator.chat("conversation-1", "Find contract 1561091");

  const systemMessage = provider.messages[0];
  assert.equal(systemMessage?.role, "system");
  assert.match(
    typeof systemMessage?.content === "string" ? systemMessage.content : "",
    /professional copilot for insurance agents/,
  );
  assert.match(
    typeof systemMessage?.content === "string" ? systemMessage.content : "",
    /GET \/contracts\/:contractNumber/,
  );
});
