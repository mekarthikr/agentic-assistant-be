import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, type ModelMessage } from "ai";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";
import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { ConversationService } from "../src/service/conversation.service";
import { ToolRegistry } from "../src/service/tool-registry.service";
import type { LLMProvider, LLMRequest, LLMResponse } from "../src/types";

class CapturingProvider implements LLMProvider {
  public readonly modelInfo = {
    model: "test-model",
    contextWindow: 1_000,
  };
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
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
      remainingTokens: 5_850,
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

test("retrieves SecureLife Plus product-guide information", () => {
  const rag = new ApiDocumentationRag();
  const [result] = rag.retrieve("What is the maximum eligibility age for SecureLife Plus?", 1);

  assert.match(result?.heading ?? "", /SecureLife Plus Insurance — Eligibility/);
  assert.match(result?.content ?? "", /Maximum age: 65 years/);
});

test("retrieves information from every supplied knowledge document", () => {
  const rag = new ApiDocumentationRag();
  const cases = [
    ["SecureLife maximum eligibility age", /Maximum age: 65 years/],
    ["How do I download my policy document?", /Download Policy Document/],
    ["What documents are required to file a claim?", /Death Certificate/],
    ["How long is the premium grace period?", /30-day grace period/],
    ["What information is required for a beneficiary?", /Percentage Allocation/],
    ["What customer support channels are available?", /Live Chat/],
  ] as const;

  for (const [query, expectedContent] of cases) {
    const [result] = rag.retrieve(query, 1);
    assert.match(result?.content ?? "", expectedContent, query);
  }
});

test("returns exact model usage and provider rate-limit balance", async () => {
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    new CapturingProvider(),
    new ToolRegistry(),
    new ApiDocumentationRag(),
  );
  const stream = orchestrator.streamChat("usage", "Hello");

  assert.deepEqual(await stream.next(), {
    done: false,
    value: "Contract lookup ready.",
  });
  assert.deepEqual(await stream.next(), {
    done: true,
    value: {
      model: "test-model",
      contextWindow: 1_000,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      remainingTokens: 5_850,
    },
  });
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
  assert.match(
    provider.instructions ?? "",
    /do not supplement it with\s+general insurance knowledge/i,
  );
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

test("does not call live-record tools for knowledge-base policy questions", async () => {
  const provider = new CapturingProvider();
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    createRegistry(),
    new ApiDocumentationRag(
      "## Policy documents\n\nOpen Policies and select Download Policy Document.",
    ),
  );

  await orchestrator.chat("policy-document", "How do I download my policy document?");

  assert.deepEqual(provider.toolNames, []);
  assert.equal(provider.toolChoice, "auto");
  assert.match(provider.instructions ?? "", /Download Policy Document/);
});

test("does not call live-record tools for customer-support questions", async () => {
  const provider = new CapturingProvider();
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    createRegistry(),
    new ApiDocumentationRag(
      "## Support Channels\n\n- Phone\n- Email\n- Live Chat",
    ),
  );

  await orchestrator.chat(
    "customer-support",
    "Which customer-support channels are available?",
  );

  assert.deepEqual(provider.toolNames, []);
  assert.equal(provider.toolChoice, "auto");
  assert.match(provider.instructions ?? "", /Live Chat/);
});

test("selects tools from the current request instead of stale record history", async () => {
  const provider = new CapturingProvider();
  const conversations = new ConversationService();
  const orchestrator = new AIOrchestrator(
    conversations,
    provider,
    createRegistry(),
    new ApiDocumentationRag("## Applications API\n\nApplication reference."),
  );

  conversations.addAssistantMessage(
    "application-history",
    "Contract 1561091 is active.",
  );

  await orchestrator.chat(
    "application-history",
    "Show me all pending applications",
  );

  assert.deepEqual(provider.toolNames, ["searchApplications"]);
  assert.deepEqual(provider.toolChoice, {
    type: "tool",
    toolName: "searchApplications",
  });
});
