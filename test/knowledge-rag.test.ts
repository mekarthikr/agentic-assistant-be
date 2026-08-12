import assert from "node:assert/strict";
import test from "node:test";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";

const rag = new ApiDocumentationRag();

test("retrieves the over-the-phone procedure for beneficiary changes", () => {
  const context = rag.retrieveContext(
    "Can an agent change a beneficiary over the phone and is spousal consent required?",
  );

  assert.match(context, /Beneficiary Changes/i);
  assert.match(context, /spousal consent/i);

  const [result] = rag.retrieve("beneficiary change spousal consent");
  assert.equal(result?.source.filename, "items-to-take-over-the-phone.pdf");
  assert.equal(result?.source.mediaType, "application/pdf");
  assert.equal(typeof result?.source.page, "number");
});

test("retrieves the correct routing procedure for suitability calls", () => {
  const context = rag.retrieveContext(
    "Where should I transfer an agent asking about a pending suitability review?",
  );

  assert.match(context, /Suitability/i);
  assert.match(context, /Suitability\s+queue/i);

  const results = rag.retrieve("pending suitability review transfer");
  assert.ok(
    results.some(
      ({ source }) =>
        source.filename === "transferring-calls-to-another-area.pdf" &&
        source.page === 5,
    ),
  );
});

test("retrieves neighboring PDF pages so procedure conditions are not lost", () => {
  const sections = rag.retrieveProcedure(
    "How can a client change a beneficiary and when is spousal consent required?",
  );

  assert.ok(sections.length >= 2);
  assert.ok(
    sections.every(({ source }) => source.mediaType === "application/pdf"),
  );
  assert.ok(sections.some(({ source }) => source.page === 2));
  assert.ok(sections.some(({ source }) => source.page === 3));

  const context = rag.formatContext(sections);
  assert.match(context, /spouse is not available/i);
  assert.match(context, /Beneficiary Changes/i);
  assert.match(context, /Source: Items to Take Over the Phone, page 3/i);
});

test("does not classify a weak PDF token match as a documented procedure", () => {
  assert.deepEqual(
    rag.retrieveProcedure(
      "Please help me with an unrelated insurance question",
    ),
    [],
  );
});
