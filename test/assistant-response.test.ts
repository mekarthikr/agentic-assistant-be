import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAssistantResponse } from "../src/utils/assistant-response";
import { INSURANCE_AGENT_SYSTEM_PROMPT } from "../src/knowledge";

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

test("instructs the model to choose clean Markdown formatting dynamically", () => {
  assert.match(INSURANCE_AGENT_SYSTEM_PROMPT, /GitHub-Flavored Markdown/);
  assert.match(INSURANCE_AGENT_SYSTEM_PROMPT, /structure dynamically/);
  assert.match(INSURANCE_AGENT_SYSTEM_PROMPT, /Do not add a generic/);
  assert.match(INSURANCE_AGENT_SYSTEM_PROMPT, /descriptive Markdown link/);
});
