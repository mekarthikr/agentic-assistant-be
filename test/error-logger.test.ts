import assert from "node:assert/strict";
import test from "node:test";

import { serializeError } from "../src/utils/error-logger";

test("serializes nested error objects including causes and stack traces", () => {
  const cause = Object.assign(new Error("Provider rejected the request."), {
    statusCode: 429,
    responseBody: '{"error":"rate_limit"}',
  });
  const error = new Error("Chat failed.", { cause });

  const serialized = serializeError(error) as Record<string, unknown>;
  const serializedCause = serialized.cause as Record<string, unknown>;

  assert.equal(serialized.name, "Error");
  assert.equal(serialized.message, "Chat failed.");
  assert.equal(typeof serialized.stack, "string");
  assert.equal(serializedCause.message, "Provider rejected the request.");
  assert.equal(serializedCause.statusCode, 429);
});

test("redacts credential-like properties and handles circular objects", () => {
  const error: Record<string, unknown> = {
    message: "Request failed.",
    apiKey: "must-not-be-logged",
  };
  error.cause = error;

  const serialized = serializeError(error) as Record<string, unknown>;

  assert.equal(serialized.apiKey, "[redacted]");
  assert.equal(serialized.cause, "[circular reference]");
});
