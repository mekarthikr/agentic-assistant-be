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

test("routes beneficiary details navigation to the beneficiaries tab", () => {
  const rag = new ApiDocumentationRag(navigationMarkdown);

  assert.deepEqual(
    rag.resolvePortalNavigation("navigation link for beneficiary details"),
    {
      linkText: "Beneficiaries",
      message: "You can access this page using the link below.",
      missingParameter: "contractId",
    },
  );
  assert.equal(
    rag.resolvePortalNavigation("beneficiary details for contract 1445587 link")
      ?.url,
    "https://dev-myportal.american-equity.com/agent/book-business/contract-details/1445587?activeTab=beneficiaries",
  );
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
  assert.equal(
    rag.resolvePortalNavigation("What is my application link?"),
    undefined,
  );
  assert.deepEqual(rag.resolvePortalNavigation("contract details page link"), {
    linkText: "Contract Details",
    message: "You can access this page using the link below.",
    missingParameter: "contractId",
  });
});

test("answers policy document requests from knowledge instead of contract navigation", () => {
  const rag = new ApiDocumentationRag();

  assert.equal(
    rag.resolvePortalNavigation("Download policy document"),
    undefined,
  );
  assert.deepEqual(rag.resolveKnowledgeAnswer("Download policy document"), {
    answer: "Open the Policies page and select Download Policy Document.",
  });
  assert.match(
    rag.retrieveContext("Download policy document"),
    /Open the Policies page and select Download Policy Document\./,
  );
});

test("returns policy document FAQ answer without inventing a link", async () => {
  const provider: LLMProvider = {
    modelInfo: { model: "test", contextWindow: 1_024 },
    generate: async () => {
      throw new Error("The model must not be called for direct KB answers.");
    },
    async *stream() {
      throw new Error("The model must not be called for direct KB answers.");
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag(),
  );

  assert.equal(
    await orchestrator.chat("policy-document-test", "Download policy document"),
    "Open the Policies page and select Download Policy Document.",
  );
});

test("answers customer support requests from customer support knowledge", () => {
  const rag = new ApiDocumentationRag();

  assert.equal(
    rag.resolveKnowledgeAnswer("Portal Login Issues")?.answer,
    "Customer support is available through Phone, Email, Live Chat.\n\nBusiness hours: Monday to Friday 8:00 AM - 6:00 PM.\n\nCommon support topics: Policy Information, Premium Payments, Claims Status, Beneficiary Updates, Portal Login Issues.",
  );
});

test("returns customer support answer without inventing a link", async () => {
  const provider: LLMProvider = {
    modelInfo: { model: "test", contextWindow: 1_024 },
    generate: async () => {
      throw new Error("The model must not be called for direct KB answers.");
    },
    async *stream() {
      throw new Error("The model must not be called for direct KB answers.");
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag(),
  );

  assert.equal(
    await orchestrator.chat("customer-support-test", "Portal Login Issues"),
    "Customer support is available through Phone, Email, Live Chat.\n\nBusiness hours: Monday to Friday 8:00 AM - 6:00 PM.\n\nCommon support topics: Policy Information, Premium Payments, Claims Status, Beneficiary Updates, Portal Login Issues.",
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

test("uses a follow-up contract ID to complete pending navigation", async () => {
  const provider: LLMProvider = {
    modelInfo: { model: "test", contextWindow: 1_024 },
    generate: async () => {
      throw new Error("The model must not be called for pending navigation.");
    },
    async *stream() {
      throw new Error("The model must not be called for pending navigation.");
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag(navigationMarkdown),
  );

  assert.equal(
    await orchestrator.chat(
      "pending-navigation-test",
      "how can i navigate to contract details page?",
    ),
    "Could you please provide the contract ID?",
  );
  assert.equal(
    await orchestrator.chat("pending-navigation-test", "1561507"),
    "You can access this page using the link below.\n\n[Contract Details](https://dev-myportal.american-equity.com/agent/book-business/contract-details/1561507?activeTab=info)",
  );
});

test("reuses the latest contract ID for same-contract navigation", async () => {
  const provider: LLMProvider = {
    modelInfo: { model: "test", contextWindow: 1_024 },
    generate: async () => {
      throw new Error(
        "The model must not be called for same-contract navigation.",
      );
    },
    async *stream() {
      throw new Error(
        "The model must not be called for same-contract navigation.",
      );
    },
  };
  const orchestrator = new AIOrchestrator(
    new ConversationService(),
    provider,
    new ToolRegistry(),
    new ApiDocumentationRag(navigationMarkdown),
  );

  await orchestrator.chat(
    "same-contract-navigation-test",
    "i want to navigate to contract details page",
  );
  await orchestrator.chat("same-contract-navigation-test", "123456");

  assert.equal(
    await orchestrator.chat(
      "same-contract-navigation-test",
      "i want to navigate to beneficiary details of same contract",
    ),
    "You can access this page using the link below.\n\n[Beneficiaries](https://dev-myportal.american-equity.com/agent/book-business/contract-details/123456?activeTab=beneficiaries)",
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
          content:
            "Your agent number is available from your application record.",
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
