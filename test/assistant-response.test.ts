import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAssistantResponse } from "../src/utils/assistant-response";

test("removes internal knowledge-source attribution from responses", () => {
  assert.equal(
    normalizeAssistantResponse(
      "According to our knowledge base, you can update the address in chat.",
    ),
    "You can update the address in chat.",
  );
  assert.equal(
    normalizeAssistantResponse(
      "**Based on the reference,** check with the Suitability team.",
    ),
    "Check with the Suitability team.",
  );
  assert.equal(
    normalizeAssistantResponse(
      "The documentation states that both owners must confirm the request.",
    ),
    "Both owners must confirm the request.",
  );
});

test("leaves a direct response unchanged", () => {
  assert.equal(
    normalizeAssistantResponse("Ask the Claims team to review the request."),
    "Ask the Claims team to review the request.",
  );
});
