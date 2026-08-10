import { jsonSchema } from "ai";

import { EnterpriseApiProvider } from "@app/providers";
import type { ApplicationTool, ToolExecutionContext } from "@app/service";
import type { ApiResponse, Contract } from "@app/types";

const contractFilters = [
  "contractNumber",
  "clientName",
  "productName",
  "contractStatus",
  "taxType",
  "taxQualification",
  "distributionCompany",
] as const;

const anniversaryDateFilter = "anniversaryDate" as const;
const anniversaryMonthFilter = "anniversaryMonth" as const;
const anniversaryYearFilter = "anniversaryYear" as const;

type AnniversaryFilterName =
  | typeof anniversaryDateFilter
  | typeof anniversaryMonthFilter
  | typeof anniversaryYearFilter;

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

type ContractSearchInput = Record<string, unknown> & {
  [filterName in AnniversaryFilterName]?: unknown;
};

type AnniversaryFilters = {
  readonly date?: string;
  readonly month?: string;
  readonly year?: string;
};

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

const anniversaryFiltersFrom = (
  input: unknown,
  now = new Date(),
): AnniversaryFilters => {
  if (!isRecord(input)) throw new Error("Tool input must be an object.");

  const date = input[anniversaryDateFilter];
  const month = input[anniversaryMonthFilter];
  const year = input[anniversaryYearFilter];

  if (
    date !== undefined &&
    date !== "" &&
    (typeof date !== "string" ||
      !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date))
  ) {
    throw new Error("anniversaryDate must use YYYY-MM-DD format.");
  }

  let resolvedMonth: string | undefined;
  if (month !== undefined && month !== "") {
    if (month === "current") {
      resolvedMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    } else if (typeof month === "string" && /^(0[1-9]|1[0-2])$/.test(month)) {
      resolvedMonth = month;
    } else {
      throw new Error(
        'anniversaryMonth must be "current" or a two-digit month from "01" to "12".',
      );
    }
  }

  if (
    year !== undefined &&
    year !== "" &&
    (typeof year !== "string" || !/^\d{4}$/.test(year))
  ) {
    throw new Error("anniversaryYear must use YYYY format.");
  }

  return {
    ...(typeof date === "string" && date ? { date } : {}),
    ...(resolvedMonth ? { month: resolvedMonth } : {}),
    ...(typeof year === "string" && year ? { year } : {}),
  };
};

const filterContractsByAnniversary = (
  response: ApiResponse<Contract[]>,
  filters: AnniversaryFilters,
): ApiResponse<Contract[]> => {
  if (!filters.date && !filters.month && !filters.year) return response;

  return {
    ...response,
    data: response.data.filter(({ anniversaryDate }) => {
      const date = anniversaryDate.slice(0, 10);
      return (
        (!filters.date || date === filters.date) &&
        (!filters.month || anniversaryDate.slice(5, 7) === filters.month) &&
        (!filters.year || anniversaryDate.slice(0, 4) === filters.year)
      );
    }),
  };
};

const scopedContractFilters = (
  input: unknown,
  context: ToolExecutionContext,
): Record<string, string | undefined> => ({
  ...filtersFrom(input, contractFilters),
  ...(context.userType === "client" && context.clientName
    ? { clientName: context.clientName }
    : {}),
});

const contractSearchSchema = {
  ...filterSchema(contractFilters),
  properties: {
    ...filterSchema(contractFilters).properties,
    [anniversaryDateFilter]: {
      type: "string" as const,
      description: "Exact anniversary date in YYYY-MM-DD format.",
    },
    [anniversaryMonthFilter]: {
      type: "string" as const,
      description:
        'Anniversary month: "current" for this month, or a two-digit month from "01" to "12".',
    },
    [anniversaryYearFilter]: {
      type: "string" as const,
      description: "Anniversary year in YYYY format.",
    },
  },
};

const scopedApplicationFilters = (
  input: unknown,
  context: ToolExecutionContext,
): Record<string, string | undefined> => ({
  ...filtersFrom(input, applicationFilters),
  ...(context.userType === "client" && context.clientName
    ? { clientName: context.clientName }
    : {}),
});

const assertClientOwnsRecord = (
  record: { clientName: string },
  context: ToolExecutionContext,
): void => {
  if (
    context.userType === "client" &&
    context.clientName &&
    record.clientName.trim().toUpperCase() !==
      context.clientName.trim().toUpperCase()
  ) {
    throw new Error("This record is not available for the current client.");
  }
};

/** Creates the enterprise capabilities that Groq can request during a chat turn. */
export const createEnterpriseTools = (
  enterpriseApi = new EnterpriseApiProvider(),
): ApplicationTool[] => [
  {
    name: "searchContracts",
    description:
      'Search insurance contracts using one or more known filters. Anniversary data can be filtered by exact anniversaryDate (YYYY-MM-DD), anniversaryMonth ("current" or MM), or anniversaryYear (YYYY). Use anniversaryMonth: "current" for anniversaries this month.',
    inputSchema: jsonSchema(contractSearchSchema),
    execute: async (input, context) => {
      const anniversary = anniversaryFiltersFrom(input);
      return filterContractsByAnniversary(
        await enterpriseApi.getContracts(
          scopedContractFilters(input as ContractSearchInput, context),
          context.signal,
        ),
        anniversary,
      );
    },
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
    execute: async (input, context) => {
      const response = await enterpriseApi.getContract(
        requiredString(input, "contractNumber"),
        context.signal,
      );
      assertClientOwnsRecord(response.data, context);
      return response;
    },
  },
  {
    name: "searchApplications",
    description:
      "Search insurance applications using one or more known filters, including application status, client name, product, agent number, or contract number.",
    inputSchema: jsonSchema(filterSchema(applicationFilters)),
    execute: async (input, context) =>
      enterpriseApi.getApplications(
        scopedApplicationFilters(input, context),
        context.signal,
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
    execute: async (input, context) => {
      const response = await enterpriseApi.getApplication(
        requiredString(input, "contractNumber"),
        context.signal,
      );
      assertClientOwnsRecord(response.data, context);
      return response;
    },
  },
];
