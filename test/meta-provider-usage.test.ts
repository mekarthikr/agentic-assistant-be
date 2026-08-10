import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema } from "ai";
import LlamaAPIClient from "llama-api-client";

import { MetaProvider } from "../src/providers/meta.provider";

test("uses exact Meta usage metrics and remaining-token header values", async () => {
  const client = new LlamaAPIClient({
    apiKey: "test-key",
    baseURL: "https://meta.test/v1",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: "completion-test",
          completion_message: {
            role: "assistant",
            content: "Hello",
            stop_reason: "stop",
          },
          metrics: [
            { metric: "num_prompt_tokens", value: 127 },
            { metric: "num_completion_tokens", value: 23 },
            { metric: "num_total_tokens", value: 150 },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining-tokens": "5850",
          },
        },
      ),
  });
  const provider = new MetaProvider(
    {
      apiKey: "test-key",
      model: "Llama-3.3-70B-Instruct",
      contextWindow: 131_072,
    },
    client,
  );

  const response = await provider.generate({
    messages: [{ role: "user", content: "Hello" }],
  });

  assert.deepEqual(response.usage, {
    inputTokens: 127,
    outputTokens: 23,
    totalTokens: 150,
  });
  assert.equal(response.remainingTokens, 5_850);
});

test("converts AI SDK tools and tool-result messages for Meta", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  let requestCount = 0;
  const metrics = [
    { metric: "num_prompt_tokens", value: 20 },
    { metric: "num_completion_tokens", value: 5 },
    { metric: "num_total_tokens", value: 25 },
  ];
  const client = new LlamaAPIClient({
    apiKey: "test-key",
    baseURL: "https://meta.test/v1",
    fetch: async (_url, init) => {
      requestBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );
      requestCount += 1;
      return new Response(
        JSON.stringify(
          requestCount === 1
            ? {
                completion_message: {
                  role: "assistant",
                  stop_reason: "tool_calls",
                  tool_calls: [
                    {
                      id: "call-1",
                      function: {
                        name: "getContract",
                        arguments: '{"contractNumber":"12345"}',
                      },
                    },
                  ],
                },
                metrics,
              }
            : {
                completion_message: {
                  role: "assistant",
                  content: "The contract is active.",
                  stop_reason: "stop",
                },
                metrics,
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });
  const provider = new MetaProvider(
    {
      apiKey: "test-key",
      model: "Llama-3.3-70B-Instruct",
      contextWindow: 131_072,
    },
    client,
  );
  const tools = {
    getContract: {
      description: "Get a contract by number.",
      inputSchema: jsonSchema({
        type: "object",
        properties: { contractNumber: { type: "string" } },
        required: ["contractNumber"],
        additionalProperties: false,
      }),
    },
  };

  const first = await provider.generate({
    messages: [{ role: "user", content: "Get contract 12345" }],
    tools,
    toolChoice: { type: "tool", toolName: "getContract" },
  });
  assert.deepEqual(first.toolCalls, [
    {
      toolCallId: "call-1",
      toolName: "getContract",
      input: { contractNumber: "12345" },
    },
  ]);

  const second = await provider.generate({
    messages: [
      { role: "user", content: "Get contract 12345" },
      first.assistantMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "getContract",
            output: { type: "text", value: '{"status":"Active"}' },
          },
        ],
      },
    ],
    tools,
    toolChoice: "auto",
  });

  assert.equal(second.text, "The contract is active.");
  assert.deepEqual(requestBodies[0]?.tool_choice, {
    type: "function",
    function: { name: "getContract" },
  });
  assert.deepEqual(
    (requestBodies[1]?.messages as Array<Record<string, unknown>>).map(
      ({ role }) => role,
    ),
    ["user", "assistant", "tool"],
  );
});
