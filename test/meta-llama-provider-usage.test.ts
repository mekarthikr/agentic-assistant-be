import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { MetaLlamaProvider } from "../src/providers/meta-llama.provider";

test("uses exact Meta Llama usage and remaining-token response header values", async () => {
  const client = createOpenAICompatible({
    name: "metaLlama",
    apiKey: "test-key",
    baseURL: "https://api.llama.com/compat/v1",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1_785_232_000,
          model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hello" },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 127,
            completion_tokens: 23,
            total_tokens: 150,
          },
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
  const provider = new MetaLlamaProvider(
    {
      apiKey: "test-key",
      baseUrl: "https://api.llama.com/compat/v1",
      model: "Llama-4-Maverick-17B-128E-Instruct-FP8",
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
