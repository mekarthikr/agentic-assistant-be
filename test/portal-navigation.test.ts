import assert from "node:assert/strict";
import test from "node:test";

import { PortalNavigationService } from "../src/service/portal-navigation.service";
import { createPortalNavigationLinkTool } from "../src/tools/get-portal-navigation-link.tool";

test("resolves configured portal routes and URL-encodes parameters", () => {
  const service = new PortalNavigationService();

  assert.deepEqual(service.getLink("banking"), {
    title: "Banking",
    url: "https://dev-myportal.american-equity.com/agent/user/profile?activeTab=banking",
  });
  assert.deepEqual(
    service.getLink("beneficiaries", { contractId: "144/5587" }),
    {
      title: "Beneficiaries",
      url: "https://dev-myportal.american-equity.com/agent/book-business/contract-details/144%2F5587?activeTab=beneficiaries",
    },
  );
});

test("returns a missing parameter instead of an invalid portal URL", () => {
  const tool = createPortalNavigationLinkTool();

  assert.deepEqual(
    tool.execute(
      { page: "contractDetails" },
      { toolCallId: "portal-navigation-test" },
    ),
    { missingParameter: "contractId" },
  );
});
