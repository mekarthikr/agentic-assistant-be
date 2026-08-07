import { jsonSchema } from "ai";

import { PortalNavigationService } from "@app/service/portal-navigation.service";
import type { ApplicationTool } from "@app/service";

type ToolInput = Record<string, unknown>;

const isRecord = (value: unknown): value is ToolInput =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const navigationInput = (input: unknown): {
  page: string;
  params: Record<string, string>;
} => {
  if (!isRecord(input) || typeof input.page !== "string") {
    return { page: "", params: {} };
  }

  const params = isRecord(input.params)
    ? Object.fromEntries(
        Object.entries(input.params).flatMap(([name, value]) =>
          typeof value === "string" ? [[name, value]] : [],
        ),
      )
    : {};

  return { page: input.page, params };
};

/** Creates the portal-navigation capability exposed to the language model. */
export const createPortalNavigationLinkTool = (
  navigationService = new PortalNavigationService(),
): ApplicationTool => ({
  name: "getPortalNavigationLink",
  description: "Returns a portal navigation link for a requested page.",
  inputSchema: jsonSchema({
    type: "object",
    properties: {
      page: {
        type: "string",
        description:
          "Portal page: profile, personalInfo, banking, documents, contractDetails, beneficiaries, or pendingContractDetails.",
      },
      params: {
        type: "object",
        description: "Route parameters, such as contractId.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["page"],
    additionalProperties: false,
  }),
  execute: (input) => {
    const { page, params } = navigationInput(input);
    return navigationService.getLink(page, params);
  },
});
