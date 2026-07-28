import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, type ModelMessage } from "ai";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";
import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { ConversationService } from "../src/service/conversation.service";
import { ToolRegistry } from "../src/service/tool-registry.service";
import type { LLMProvider, LLMRequest, LLMResponse } from "../src/types";

class CapturingProvider implements LLMProvider {
  public instructions: string | undefined;
  public messages: readonly ModelMessage[] = [];
  public toolNames: readonly string[] = [];
  public toolChoice: LLMRequest["toolChoice"];

  public async generate(request: LLMRequest): Promise<LLMResponse> {
    this.instructions = request.instructions;
    this.messages = request.messages;
    this.toolNames = Object.keys(request.tools ?? {});
    this.toolChoice = request.toolChoice;
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

const createRegistry = (): ToolRegistry =>
  new ToolRegistry(
    [
      "searchContracts",
      "getContract",
      "searchApplications",
      "getApplication",
    ].map((name) => ({
      name,
      description: name,
      inputSchema: jsonSchema({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: () => null,
    })),
  );

test("loads the generated enterprise API RAG index", () => {
  const rag = new ApiDocumentationRag();
  const [result] = rag.retrieve("approved insurance applications", 1);

  assert.equal(result?.heading, "Get All Applications");
  assert.match(result?.content ?? "", /GET \/applications/);
  assert.ok(rag.retrieveContext("applications", 10).length <= 3_500);
});

test("adds insurance scope and retrieved API context as instructions", async () => {
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

  assert.equal(provider.messages[0]?.role, "user");
  assert.match(
    provider.instructions ?? "",
    /professional copilot for insurance agents/,
  );
  assert.match(provider.instructions ?? "", /GET \/contracts\/:contractNumber/);
});

test("sends only the most recent conversation messages", async () => {
  const provider = new CapturingProvider();
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag("## Contracts API\n\nContract reference."),
  );

  for (let turn = 1; turn <= 5; turn += 1) {
    await orchestrator.chat("conversation-1", `Question ${turn}`);
  }

  assert.equal(provider.messages.length, 6);
  assert.equal(provider.messages.at(-1)?.content, "Question 5");
});

test("exposes only tools relevant to the current request", async () => {
  const provider = new CapturingProvider();
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    createRegistry(),
    new ApiDocumentationRag("## Contracts API\n\nContract reference."),
  );

  await orchestrator.chat("contract", "Find contract 1561091");
  assert.deepEqual(provider.toolNames, ["getContract"]);
  assert.deepEqual(provider.toolChoice, {
    type: "tool",
    toolName: "getContract",
  });

  await orchestrator.chat("application", "Show approved applications");
  assert.deepEqual(provider.toolNames, ["searchApplications"]);

  await orchestrator.chat("contract-typo", "Get me all contrats");
  assert.deepEqual(provider.toolNames, ["searchContracts"]);
  assert.deepEqual(provider.toolChoice, {
    type: "tool",
    toolName: "searchContracts",
  });

  await orchestrator.chat("greeting", "Hello");
  assert.deepEqual(provider.toolNames, []);
  assert.equal(provider.toolChoice, "auto");
});
