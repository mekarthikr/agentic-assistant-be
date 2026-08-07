import assert from "node:assert/strict";
import test from "node:test";

import {
  isPortalNavigationRequest,
  PortalNavigationService,
} from "../src/service/portal-navigation.service";
import { createPortalNavigationLinkTool } from "../src/tools/getPortalNavigationLink.tool";

test("builds configured portal links and encodes placeholders", () => {
  const service = new PortalNavigationService();

  assert.deepEqual(service.getLink("banking"), {
    title: "Banking",
    url: "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=banking",
  });
  assert.deepEqual(service.getLink("contractDetails", { contractId: "144/5587" }), {
    title: "Contract Details",
    url: "https://dev-myportal.american-equity.com/agent/book-business/contract-details/144%2F5587?activeTab=info",
  });
});

test("returns typed missing and unsupported results without throwing", () => {
  const service = new PortalNavigationService();

  assert.deepEqual(service.getLink("beneficiaries"), {
    missingParameter: "contractId",
  });
  assert.deepEqual(service.getLink("unknown"), { unsupportedPage: "unknown" });
});

test("recognizes direct portal navigation-link requests", () => {
  assert.equal(isPortalNavigationRequest("navigation link for banking page"), true);
  assert.equal(isPortalNavigationRequest("Take me to banking"), true);
  assert.equal(isPortalNavigationRequest("show banking transactions"), false);
});

test("exposes portal navigation as an application tool", () => {
  const tool = createPortalNavigationLinkTool();

  assert.deepEqual(tool.execute({ page: "documents" }, { toolCallId: "test" }), {
    title: "Documents",
    url: "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=documents",
  });
});
