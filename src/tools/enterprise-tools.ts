import { jsonSchema } from "ai";

import { EnterpriseApiProvider } from "@app/providers";
import type { ApplicationTool } from "@app/service";

const contractFilters = [
  "contractNumber",
  "clientName",
  "productName",
  "contractStatus",
  "taxType",
  "taxQualification",
  "distributionCompany",
] as const;

const applicationFilters = [
  "clientName",
  "product",
  "taxType",
  "status",
  "contractNumber",
  "productId",
  "agentNumber",
  "contactId",
  "applicationName",
  "startDate",
] as const;

type FilterName =
  (typeof contractFilters)[number] | (typeof applicationFilters)[number];
type ToolInput = Record<string, unknown>;

const isRecord = (value: unknown): value is ToolInput =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (input: unknown, field: string): string => {
  if (
    !isRecord(input) ||
    typeof input[field] !== "string" ||
    !input[field].trim()
  ) {
    throw new Error(`${field} is required.`);
  }
  return input[field].trim();
};

const filtersFrom = (
  input: unknown,
  names: readonly FilterName[],
): Record<string, string | undefined> => {
  if (!isRecord(input)) throw new Error("Tool input must be an object.");

  return Object.fromEntries(
    names.map((name) => [
      name,
      typeof input[name] === "string" ? input[name].trim() : undefined,
    ]),
  );
};

const filterSchema = (names: readonly string[]) => ({
  type: "object" as const,
  properties: Object.fromEntries(
    names.map((name) => [
      name,
      { type: "string" as const, description: `Optional ${name} filter.` },
    ]),
  ),
  additionalProperties: false as const,
});

/** Creates the enterprise capabilities that Groq can request during a chat turn. */
export const createEnterpriseTools = (
  enterpriseApi = new EnterpriseApiProvider(),
): ApplicationTool[] => [
  {
    name: "searchContracts",
    description:
      "Search insurance contracts using one or more known filters. Use this for contract lists or when a client name, product, status, or tax details are provided.",
    inputSchema: jsonSchema(filterSchema(contractFilters)),
    execute: (input, { signal }) =>
      enterpriseApi.getContracts(filtersFrom(input, contractFilters), signal),
  },
  {
    name: "getContract",
    description:
      "Get one insurance contract when its contract number is known.",
    inputSchema: jsonSchema({
      type: "object",
      properties: { contractNumber: { type: "string" } },
      required: ["contractNumber"],
      additionalProperties: false,
    }),
    execute: (input, { signal }) =>
      enterpriseApi.getContract(
        requiredString(input, "contractNumber"),
        signal,
      ),
  },
  {
    name: "searchApplications",
    description:
      "Search insurance applications using one or more known filters, including application status, client name, product, agent number, or contract number.",
    inputSchema: jsonSchema(filterSchema(applicationFilters)),
    execute: (input, { signal }) =>
      enterpriseApi.getApplications(
        filtersFrom(input, applicationFilters),
        signal,
      ),
  },
  {
    name: "getApplication",
    description:
      "Get one insurance application or approval status when its contract number is known.",
    inputSchema: jsonSchema({
      type: "object",
      properties: { contractNumber: { type: "string" } },
      required: ["contractNumber"],
      additionalProperties: false,
    }),
    execute: (input, { signal }) =>
      enterpriseApi.getApplication(
        requiredString(input, "contractNumber"),
        signal,
      ),
  },
];
