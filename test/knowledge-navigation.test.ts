import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ApiDocumentationRag } from "../src/knowledge/api-documentation-rag";
import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { ConversationService } from "../src/service/conversation.service";
import { ToolRegistry } from "../src/service/tool-registry.service";
import type { LLMProvider } from "../src/types/ai.types";

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

  assert.deepEqual(rag.resolvePortalNavigation("Take me to banking"), {
    linkText: "Banking",
    message: "You can access this page using the link below.",
    url: "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=banking",
  });
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

test("does not resolve contract list requests as contract details navigation", () => {
  const rag = new ApiDocumentationRag(navigationMarkdown);

  assert.equal(rag.resolvePortalNavigation("show contract list"), undefined);
  assert.equal(
    rag.retrieveContext("show contract list").includes("missingParameter"),
    false,
  );
});

test("uses navigation only for explicit page, URL, link, or navigation requests", () => {
  const rag = new ApiDocumentationRag(navigationMarkdown);

  assert.equal(rag.resolvePortalNavigation("contract details"), undefined);
  assert.equal(rag.resolvePortalNavigation("banking"), undefined);
  assert.equal(rag.resolvePortalNavigation("What is my application link?"), undefined);
  assert.deepEqual(rag.resolvePortalNavigation("contract details page link"), {
    linkText: "Contract Details",
    message: "You can access this page using the link below.",
    missingParameter: "contractId",
  });
});

test("answers policy document requests from knowledge instead of contract navigation", () => {
  const rag = new ApiDocumentationRag();

  assert.equal(rag.resolvePortalNavigation("Download policy document"), undefined);
  assert.match(
    rag.retrieveContext("Download policy document"),
    /Open the Policies page and select Download Policy Document\./,
  );
});

test("returns a labeled Markdown link without invoking the model", async () => {
  const provider: LLMProvider = {
    modelInfo: { model: "test", contextWindow: 1_024 },
    generate: async () => {
      throw new Error("The model must not be called for portal navigation.");
    },
    async *stream() {
      throw new Error("The model must not be called for portal navigation.");
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag(navigationMarkdown),
  );

  assert.equal(
    await orchestrator.chat("navigation-test", "Open contract 1561440"),
    "You can access this page using the link below.\n\n[Contract Details](https://dev-myportal.american-equity.com/agent/book-business/contract-details/1561440?activeTab=info)",
  );
});

test("does not reuse previous navigation context for a later data question", async () => {
  const generatedRequests: Parameters<LLMProvider["generate"]>[0][] = [];
  const provider: LLMProvider = {
    modelInfo: { model: "test", contextWindow: 1_024 },
    generate: async (request) => {
      generatedRequests.push(request);
      return {
        text: "Your agent number is available from your application record.",
        toolCalls: [],
        assistantMessage: {
          role: "assistant",
          content: "Your agent number is available from your application record.",
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        remainingTokens: null,
      };
    },
    async *stream() {
      throw new Error("stream is not used in this test.");
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag(navigationMarkdown),
  );

  await orchestrator.chat("navigation-context-test", "Take me to banking");

  assert.equal(
    await orchestrator.chat(
      "navigation-context-test",
      "What is my agent number?",
      { userType: "client" },
    ),
    "Your agent number is available from your application record.",
  );
  assert.equal(generatedRequests.length, 1);
  assert.doesNotMatch(
    generatedRequests[0].instructions ?? "",
    /<knowledge_base_reference>[\s\S]*Banking/,
  );
});
