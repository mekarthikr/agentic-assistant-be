import { jsonSchema } from "ai";

import { PortalNavigationService } from "@app/service/portal-navigation.service";
import type { ApplicationTool } from "@app/service";

type ToolInput = Record<string, unknown>;

const isRecord = (value: unknown): value is ToolInput =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredPage = (input: unknown): string => {
  if (
    !isRecord(input) ||
    typeof input.page !== "string" ||
    !input.page.trim()
  ) {
    throw new Error("page is required.");
  }
  return input.page.trim();
};

const optionalParams = (input: unknown): Record<string, string> => {
  if (!isRecord(input) || input.params === undefined) return {};
  if (!isRecord(input.params)) {
    throw new Error("params must be an object with string values.");
  }

  return Object.fromEntries(
    Object.entries(input.params).map(([name, value]) => {
      if (typeof value !== "string") {
        throw new Error("params must be an object with string values.");
      }
      return [name, value];
    }),
  );
};

/** Creates the portal-navigation capability exposed to the LLM. */
export const createPortalNavigationLinkTool = (
  navigationService = new PortalNavigationService(),
): ApplicationTool => ({
  name: "getPortalNavigationLink",
  description:
    "Returns a direct portal navigation link when the user asks how to navigate to a page, open a screen, or access a specific section of the insurance portal. Supported pages are profile, personalInfo, banking, documents, pendingContractDetails, contractDetails, and beneficiaries. Use contractId in params for pendingContractDetails, contractDetails, and beneficiaries.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      page: {
        type: "string",
        description: "The supported portal page to open.",
      },
      params: {
        type: "object",
        description: "Optional URL parameters, such as contractId.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["page"],
    additionalProperties: false,
  }),
  execute: (input) =>
    navigationService.getLink(requiredPage(input), optionalParams(input)),
});
