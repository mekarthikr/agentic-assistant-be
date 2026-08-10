import assert from "node:assert/strict";
import test from "node:test";

import {
  getRetryAfterMs,
  isOutputParseError,
  isRateLimitError,
  isTokenLimitError,
  ProviderError,
  TokenLimitError,
} from "../src/types";

test("detects an output token limit through wrapped provider errors", () => {
  const error = new ProviderError(
    "The AI provider could not generate a response.",
    new Error("Meta Llama failed", {
      cause: new TokenLimitError("output"),
    }),
  );

  assert.equal(isTokenLimitError(error), true);
});

test("detects a provider context-length response", () => {
  const error = {
    responseBody: JSON.stringify({
      error: {
        code: "context_length_exceeded",
        message: "Maximum context length exceeded.",
      },
    }),
  };

  assert.equal(isTokenLimitError(error), true);
  assert.equal(isTokenLimitError(new Error("Network unavailable.")), false);
});

test("detects a wrapped rate limit and extracts Retry-After seconds", () => {
  const error = new ProviderError("Provider failed", {
    statusCode: 429,
    responseHeaders: {
      "retry-after": "12.5",
    },
  });

  assert.equal(isRateLimitError(error), true);
  assert.equal(getRetryAfterMs(error), 12_500);
});

test("extracts an HTTP-date Retry-After value", () => {
  const now = Date.parse("2026-07-28T10:00:00.000Z");
  const error = {
    responseHeaders: {
      "Retry-After": "Tue, 28 Jul 2026 10:00:30 GMT",
    },
  };

  assert.equal(getRetryAfterMs(error, now), 30_000);
  assert.equal(isRateLimitError(new Error("Network unavailable.")), false);
});

test("detects provider output parsing failures through wrappers", () => {
  const error = new ProviderError("Provider failed", {
    statusCode: 400,
    responseBody: JSON.stringify({
      error: {
        code: "output_parse_failed",
        message: "The generated output could not be parsed.",
      },
    }),
  });

  assert.equal(isOutputParseError(error), true);
  assert.equal(isOutputParseError(new Error("Network unavailable.")), false);
});

test("detects provider tool-call schema validation failures", () => {
  const error = {
    statusCode: 400,
    responseBody: JSON.stringify({
      error: {
        code: "tool_use_failed",
        message:
          "tool call validation failed: parameters for tool getApplication did not match schema",
      },
    }),
  };

  assert.equal(isOutputParseError(error), true);
});
