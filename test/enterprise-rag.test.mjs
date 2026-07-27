import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EnterpriseRagService,
  parseEnterpriseApiDocumentation,
} from "../dist/service/enterprise-rag.service.js";
import { AIOrchestrator } from "../dist/service/ai-orchestrator.service.js";
import { ConversationService } from "../dist/service/conversation.service.js";
import { ToolRegistry } from "../dist/service/tool-registry.service.js";
import { jsonSchema } from "ai";

const documentationPath = path.resolve(
  "src/docs/enterprise-api-documentation.md",
);

test("discovers endpoint tools and parameters from the Markdown", async () => {
  const markdown = await readFile(documentationPath, "utf8");
  const endpoints = parseEnterpriseApiDocumentation(markdown);

  assert.deepEqual(
    endpoints.map(({ id }) => id),
    [
      "get_contracts",
      "get_contracts_by_contract_number",
      "get_applications",
      "get_applications_by_contract_number",
    ],
  );
  assert.equal(endpoints[0].parameters.length, 7);
  assert.deepEqual(endpoints[1].parameters[0], {
    name: "contractNumber",
    location: "path",
    required: true,
    description: "The contract number",
  });
});

test("persists the index and retrieves relevant documented operations", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "enterprise-rag-"),
  );
  const indexPath = path.join(temporaryDirectory, "index.json");

  try {
    const rag = await EnterpriseRagService.load(documentationPath, indexPath);
    const storedIndex = JSON.parse(await readFile(indexPath, "utf8"));

    assert.equal(storedIndex.entries.length, 4);
    assert.equal(
      rag.retrieve("approval status for contract 1561438").toolNames[0],
      "get_applications_by_contract_number",
    );
    assert.equal(
      rag.retrieve("find active contracts for a client").toolNames[0],
      "get_contracts",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("always supplies the insurance-only system prompt", async () => {
  const requests = [];
  const provider = {
    async generate(request) {
      requests.push(request);
      return {
        text: "I can only help with insurance-related questions.",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "I can only help with insurance-related questions.",
        },
      };
    },
    async *stream() {},
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
  );

  await orchestrator.chat("insurance-scope", "Write a sorting algorithm");

  assert.match(requests[0].system, /insurance service agent/i);
  assert.match(requests[0].system, /answer only questions about insurance/i);
  assert.match(requests[0].system, /must call the tool before answering/i);
});

test("executes an AI-selected API tool and returns its result for formatting", async () => {
  const requests = [];
  const provider = {
    async generate(request) {
      requests.push(request);
      if (requests.length === 1) {
        const toolCall = {
          toolCallId: "call-1",
          toolName: "get_contract",
          input: { contractNumber: "1561091" },
        };
        return {
          text: "",
          toolCalls: [toolCall],
          assistantMessage: {
            role: "assistant",
            content: [{ type: "tool-call", ...toolCall }],
          },
        };
      }

      return {
        text: "Contract 1561091 is Active.",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Contract 1561091 is Active.",
        },
      };
    },
    async *stream() {},
  };
  const tools = new ToolRegistry([
    {
      name: "get_contract",
      description: "Get an insurance contract by contract number.",
      inputSchema: jsonSchema({
        type: "object",
        properties: { contractNumber: { type: "string" } },
        required: ["contractNumber"],
        additionalProperties: false,
      }),
      execute: ({ contractNumber }) => ({
        success: true,
        data: { contractNumber, contractStatus: "Active" },
      }),
    },
  ]);
  const retrieval = {
    retrieve: () => ({
      context: "Get contract: GET /contracts/:contractNumber",
      toolNames: ["get_contract"],
    }),
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    tools,
    retrieval,
  );

  const answer = await orchestrator.chat(
    "tool-flow",
    "What is the status of contract 1561091?",
  );

  assert.equal(answer, "Contract 1561091 is Active.");
  assert.equal(requests.length, 2);
  assert.deepEqual(Object.keys(requests[0].tools), ["get_contract"]);
  assert.equal(requests[1].messages.at(-1).role, "tool");
  assert.match(
    requests[1].messages.at(-1).content[0].output.value,
    /"contractStatus":"Active"/,
  );
  assert.match(requests[1].system, /format/i);
});
