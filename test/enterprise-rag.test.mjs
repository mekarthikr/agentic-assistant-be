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
import { INSURANCE_ASSISTANT_SYSTEM_PROMPT } from "../dist/prompts/index.js";

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
    assert.equal(rag.retrieve("hello, how are you?"), undefined);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("applies the insurance system prompt to every model request", async () => {
  let receivedRequest;
  const provider = {
    async generate(request) {
      receivedRequest = request;
      return {
        text: "Hello!",
        toolCalls: [],
        assistantMessage: { role: "assistant", content: "Hello!" },
      };
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
  );

  await orchestrator.chat("prompt-test", "Hello");

  assert.equal(receivedRequest.system, INSURANCE_ASSISTANT_SYSTEM_PROMPT);
});
