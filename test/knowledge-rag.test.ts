import assert from "node:assert/strict";
import test from "node:test";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";

const rag = new ApiDocumentationRag();

test("retrieves the over-the-phone procedure for beneficiary changes", () => {
  const context = rag.retrieveContext(
    "Can an agent change a beneficiary over the phone and is spousal consent required?",
  );

  assert.match(context, /items-to-take-over-the-phone\.pdf/i);
  assert.match(context, /Beneficiary Changes/i);
  assert.match(context, /spousal consent/i);
});

test("retrieves the correct routing procedure for suitability calls", () => {
  const context = rag.retrieveContext(
    "Where should I transfer an agent asking about a pending suitability review?",
  );

  assert.match(context, /transferring-calls-to-another-area\.pdf/i);
  assert.match(context, /Suitability/i);
  assert.match(context, /Suitability\s+queue/i);
});
