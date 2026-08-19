import assert from "node:assert/strict";
import test from "node:test";
import { createGroq } from "@ai-sdk/groq";

import { GroqProvider } from "../src/providers/groq.provider";

test("uses exact Groq usage and remaining-token response header values", async () => {
  const client = createGroq({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1_785_232_000,
          model: "openai/gpt-oss-20b",
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
  const provider = new GroqProvider(
    {
      apiKey: "test-key",
      model: "openai/gpt-oss-20b",
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
