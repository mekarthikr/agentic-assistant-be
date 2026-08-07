import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";

const navigationMarkdown = readFileSync(
  new URL("../src/knowledge/navigation/portal-navigation.md", import.meta.url),
  "utf8",
);

test("retrieves the configured banking link from Markdown knowledge", () => {
  const rag = new ApiDocumentationRag(navigationMarkdown);

  assert.equal(
    rag.retrieveContext("Take me to banking"),
    "Portal navigation result\nMessage:\nYou can access this page using the link below.\n\nLink Text:\nBanking\n\nURL:\nhttps://dev-myportal.american-equity.com/agent/user/profile?activeTab=banking",
  );
});

test("retrieves navigation from the generated knowledge index", () => {
  const rag = new ApiDocumentationRag();

  assert.match(
    rag.retrieveContext("Take me to banking"),
    /https:\/\/dev-myportal\.american-equity\.com\/agent\/user\/profile\?activeTab=banking/,
  );
});

test("resolves contract URL parameters and reports missing values", () => {
  const rag = new ApiDocumentationRag(navigationMarkdown);

  assert.equal(
    rag.resolvePortalNavigation("Navigate to Contract 1445587")?.url,
    "https://dev-myportal.american-equity.com/agent/book-business/contract-details/1445587?activeTab=info",
  );
  assert.deepEqual(rag.resolvePortalNavigation("Open contract details"), {
    linkText: "Contract Details",
    message: "You can access this page using the link below.",
    missingParameter: "contractId",
  });
});
