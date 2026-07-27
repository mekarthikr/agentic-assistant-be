import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
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
import app from "../dist/app.js";
import { flowTracer } from "../dist/observability/index.js";

const documentationPath = path.resolve(
  "src/docs/enterprise-api-documentation.md",
);

test("discovers endpoint tools and parameters from the Markdown", async () => {
  const markdown = await readFile(documentationPath, "utf8");
  const endpoints = parseEnterpriseApiDocumentation(markdown);

  assert.deepEqual(
    endpoints.map(({ id }) => id),
    [
      "get_health",
      "get_contracts",
      "get_contracts_by_contract_number",
      "get_applications",
      "get_applications_by_contract_number",
    ],
  );
  assert.equal(endpoints[1].parameters.length, 7);
  assert.deepEqual(endpoints[2].parameters[0], {
    name: "contractNumber",
    type: "string",
    location: "path",
    required: true,
    description: "Exact issued contract identifier",
  });
  assert.equal(endpoints[1].path, "/api/v1/contracts");
});

test("persists the index and retrieves relevant documented operations", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "enterprise-rag-"),
  );
  const indexPath = path.join(temporaryDirectory, "index.json");

  try {
    const rag = await EnterpriseRagService.load(documentationPath, indexPath);
    const storedIndex = JSON.parse(await readFile(indexPath, "utf8"));

    assert.equal(storedIndex.entries.length, 5);
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
  assert.match(
    receivedRequest.system,
    /back-office copilot for a professional insurance agent/,
  );
  assert.match(receivedRequest.system, /Never use placeholders/);
});

test("retries instead of exposing pseudo-tool markup to the agent", async () => {
  const requests = [];
  const provider = {
    async generate(request) {
      requests.push(request);
      const text =
        requests.length === 1
          ? '<to=GET /contracts>get_contracts{"clientName":"YOUR NAME HERE"}</to>'
          : "Which client name or contract number should I look up?";
      return {
        text,
        toolCalls: [],
        assistantMessage: { role: "assistant", content: text },
      };
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
  );

  const response = await orchestrator.chat(
    "tool-markup-test",
    "Show contracts under my name",
  );

  assert.equal(requests.length, 2);
  assert.match(requests[1].system, /exposed internal tool-call syntax/);
  assert.equal(
    response,
    "Which client name or contract number should I look up?",
  );
  assert.doesNotMatch(response, /get_contracts|YOUR NAME HERE|<to=/);
});

test("serves the live flow dashboard and streams sanitized history", async () => {
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const marker = `flow-test-${Date.now()}`;

  try {
    flowTracer.record({
      stage: "system",
      action: marker,
      summary: "Flow dashboard test event.",
      details: { apiKey: "must-not-leak", visible: "retained" },
    });

    const pageResponse = await fetch(`${baseUrl}/view-flow`);
    const page = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(page, /Backend decision flow/);

    const streamResponse = await fetch(`${baseUrl}/view-flow/events`);
    const reader = streamResponse.body.getReader();
    const { value } = await reader.read();
    const initialStream = new TextDecoder().decode(value);
    await reader.cancel();

    assert.equal(streamResponse.status, 200);
    assert.match(initialStream, /event: snapshot/);
    assert.match(initialStream, new RegExp(marker));
    assert.doesNotMatch(initialStream, /must-not-leak/);
    assert.match(initialStream, /\[REDACTED\]/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
