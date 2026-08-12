import assert from "node:assert/strict";
import test from "node:test";

import generatedIndex from "../src/knowledge/enterprise-api-rag.json" with { type: "json" };

test("LangChain index has bounded chunks and unique Chroma coordinates", () => {
  assert.equal(generatedIndex.version, 4);
  const ids = generatedIndex.sections.map(
    ({ source }) =>
      `${source.filename}:${"page" in source ? source.page : 0}:${source.chunkIndex}`,
  );

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(
    generatedIndex.sections.every(({ content }) => content.length <= 2_450),
  );
  assert.ok(
    generatedIndex.sections.some(
      ({ source }) =>
        source.mediaType === "application/pdf" &&
        "isContentsPage" in source &&
        source.isContentsPage === true,
    ),
  );
  assert.ok(
    generatedIndex.sections.some(
      ({ source }) =>
        source.mediaType === "application/pdf" && source.ragEligible === true,
    ),
  );
  assert.ok(
    generatedIndex.sections.some(
      ({ source }) => source.ragEligible === false,
    ),
  );
});
