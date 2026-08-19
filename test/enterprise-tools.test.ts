import assert from "node:assert/strict";
import test from "node:test";

import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { createEnterpriseTools } from "../src/tools/enterprise-tools";
import type { ApiResponse, Application, Contract } from "../src/types";

const contracts: Contract[] = [
  {
    contractNumber: "1561092",
    clientName: "SMITH JOHN",
    productName: "Product A",
    issuedDate: "2025-03-10T05:00:00+00:00",
    currentValue: 0,
    anniversaryDate: "2026-03-10T05:00:00+00:00",
    taxType: "Qualified",
    contractStatus: "Active",
    taxQualification: "IRA",
    distributionCompany: "AELife",
  },
  {
    contractNumber: "1561094",
    clientName: "WILLIAMS ROBERT",
    productName: "Product B",
    issuedDate: "2025-08-05T05:00:00+00:00",
    currentValue: 0,
    anniversaryDate: "2026-08-05T05:00:00+00:00",
    taxType: "Qualified",
    contractStatus: "Active",
    taxQualification: "IRA",
    distributionCompany: "AELife",
  },
  {
    contractNumber: "1561103",
    clientName: "WHITE SUSAN",
    productName: "Product C",
    issuedDate: "2024-08-12T05:00:00+00:00",
    currentValue: 0,
    anniversaryDate: "2025-08-12T05:00:00+00:00",
    taxType: "Non-Qualified",
    contractStatus: "Active",
    taxQualification: "NON-QUAL",
    distributionCompany: "AELife",
  },
];

test("filters contract anniversaries by exact date, month, or year", async () => {
  const response: ApiResponse<Contract[]> = {
    success: true,
    message: "Request successful",
    data: contracts,
    timestamp: "2026-08-04T00:00:00.000Z",
  };
  const searchContracts = createEnterpriseTools({
    getContracts: async () => response,
  } as never).find(({ name }) => name === "searchContracts");

  const search = async (filters: Record<string, string>) =>
    (await searchContracts?.execute(filters, {
      toolCallId: "anniversary-test",
    })) as ApiResponse<Contract[]>;

  assert.deepEqual(
    (await search({ anniversaryMonth: "08" })).data.map(
      ({ contractNumber }) => contractNumber,
    ),
    ["1561094", "1561103"],
  );
  assert.deepEqual(
    (await search({ anniversaryYear: "2026" })).data.map(
      ({ contractNumber }) => contractNumber,
    ),
    ["1561092", "1561094"],
  );
  assert.deepEqual(
    (await search({ anniversaryDate: "2026-08-05" })).data.map(
      ({ contractNumber }) => contractNumber,
    ),
    ["1561094"],
  );
});

test("searches all client contracts by the trusted client name", async () => {
  let receivedFilters: Record<string, string | undefined> | undefined;
  const response: ApiResponse<Contract[]> = {
    success: true,
    message: "Request successful",
    data: [contracts[0], contracts[1]],
    timestamp: "2026-08-04T00:00:00.000Z",
  };
  const searchContracts = createEnterpriseTools({
    getContracts: async (filters: Record<string, string | undefined>) => {
      receivedFilters = filters;
      return response;
    },
    getContract: async () => {
      throw new Error(
        "Client contract searches must use the contracts list API.",
      );
    },
  } as never).find(({ name }) => name === "searchContracts");

  const result = (await searchContracts?.execute(
    {},
    {
      toolCallId: "client-contracts-test",
      userType: "client",
      clientName: "SMITH ROBERT",
    },
  )) as ApiResponse<Contract[]>;

  assert.equal(receivedFilters?.clientName, "SMITH ROBERT");
  assert.deepEqual(
    result.data.map(({ contractNumber, clientName, taxQualification }) => ({
      contractNumber,
      clientName,
      taxQualification,
    })),
    [
      {
        contractNumber: "1561092",
        clientName: "Smith John",
        taxQualification: "Ira",
      },
      {
        contractNumber: "1561094",
        clientName: "Williams Robert",
        taxQualification: "Ira",
      },
    ],
  );
});

test("searches client applications by the trusted client name", async () => {
  let receivedFilters: Record<string, string | undefined> | undefined;
  const response: ApiResponse<Application[]> = {
    success: true,
    message: "Request successful",
    data: [],
    timestamp: "2026-08-04T00:00:00.000Z",
  };
  const searchApplications = createEnterpriseTools({
    getApplications: async (filters: Record<string, string | undefined>) => {
      receivedFilters = filters;
      return response;
    },
  } as never).find(({ name }) => name === "searchApplications");

  await searchApplications?.execute(
    {},
    {
      toolCallId: "client-applications-test",
      userType: "client",
      clientName: "SMITH ROBERT",
    },
  );

  assert.equal(receivedFilters?.clientName, "SMITH ROBERT");
});

test("normalizes upper-case application display fields without changing IDs", async () => {
  const response: ApiResponse<Application[]> = {
    success: true,
    message: "Request successful",
    data: [
      {
        clientName: "SDF SDF",
        product: "AMERICAN EQUITY ESTATESHIELD 10 FIXED INDEX ANNUITY",
        anticipatedPremium: 99999,
        startDate: "2026-07-15T13:27:11.782+00:00",
        taxType: "NON QUALIFIED",
        status: "IN PROGRESS",
        contractNumber: "1561438",
        productId: "I-ESTATE24",
        agentNumber: "2026",
        contactId: "482354",
        applicationName: "SDF SDF APPLICATION",
      },
    ],
    timestamp: "2026-08-04T00:00:00.000Z",
  };
  const searchApplications = createEnterpriseTools({
    getApplications: async () => response,
  } as never).find(({ name }) => name === "searchApplications");

  const result = (await searchApplications?.execute(
    {},
    { toolCallId: "display-casing-test" },
  )) as ApiResponse<Application[]>;

  assert.equal(
    result.data[0].product,
    "American Equity Estateshield 10 Fixed Index Annuity",
  );
  assert.equal(result.data[0].status, "In Progress");
  assert.equal(result.data[0].productId, "I-ESTATE24");
  assert.equal(result.data[0].contractNumber, "1561438");
});

test("routes client contract questions to the contract list only", () => {
  const orchestrator = new AIOrchestrator(
    {} as never,
    {} as never,
    {} as never,
  );
  const selectToolNames = (
    orchestrator as unknown as {
      selectToolNames(query: string, userType: "client"): readonly string[];
    }
  ).selectToolNames.bind(orchestrator);

  assert.deepEqual(selectToolNames("What is my contract number?", "client"), [
    "searchContracts",
  ]);
  assert.deepEqual(selectToolNames("What are my contract details?", "client"), [
    "searchContracts",
  ]);
  assert.deepEqual(selectToolNames("1561507", "client"), ["getContract"]);
  assert.deepEqual(
    selectToolNames("What is my application status?", "client"),
    ["searchApplications"],
  );
  assert.deepEqual(selectToolNames("What is my product name?", "client"), [
    "searchContracts",
  ]);
  assert.deepEqual(selectToolNames("What is my name?", "client"), []);
});

test("routes application product searches to the applications tool", () => {
  const orchestrator = new AIOrchestrator(
    {} as never,
    {} as never,
    {} as never,
  );
  const selectToolNames = (
    orchestrator as unknown as {
      selectToolNames(query: string, userType: "agent"): readonly string[];
    }
  ).selectToolNames.bind(orchestrator);

  assert.deepEqual(
    selectToolNames("Find application for Estateshield product.", "agent"),
    ["searchApplications"],
  );
  assert.deepEqual(
    selectToolNames("Search applications for Estateshield.", "agent"),
    ["searchApplications"],
  );
});

test("adds headings to application and contract list responses", () => {
  const orchestrator = new AIOrchestrator(
    {} as never,
    {} as never,
    {} as never,
  );
  const format = (
    orchestrator as unknown as {
      formatRecordListHeading(query: string, response: string): string;
    }
  ).formatRecordListHeading.bind(orchestrator);

  assert.equal(
    format(
      "Show all submitted applications.",
      "Application 1561438 is submitted.",
    ),
    "Here are the Submitted Applications:\n\nApplication 1561438 is submitted.",
  );
  assert.equal(
    format(
      "Find all pending applications.",
      "**Pending (In Progress) Applications**\n\n- Application 1561438 is in progress.",
    ),
    "Here are the Pending (In Progress) Applications:\n\n- Application 1561438 is in progress.",
  );
  assert.equal(
    format(
      "Find all non-qualified contracts.",
      "Non-Qualified Contracts\n\nContract 1561091 is active.",
    ),
    "Following contracts are Non-Qualified:\n\nContract 1561091 is active.",
  );
  assert.equal(
    format("List contracts.", "Contract 1561092 is active."),
    "Following contracts are:\n\nContract 1561092 is active.",
  );
});

test("formats a client multi-contract product answer from the returned records", () => {
  const orchestrator = new AIOrchestrator(
    {} as never,
    {} as never,
    {} as never,
  );
  const format = (
    orchestrator as unknown as {
      formatClientProductSelection(
        query: string,
        response: string,
        userType: "client",
        results: readonly unknown[],
      ): string;
    }
  ).formatClientProductSelection.bind(orchestrator);

  const result = format(
    "What is my product name?",
    "You have two contracts.",
    "client",
    [
      {
        success: true,
        message: "Request successful",
        data: contracts.map((contract) => ({
          ...contract,
          productName: contract.productName.toUpperCase(),
        })),
        timestamp: "2026-08-04T00:00:00.000Z",
      },
    ],
  );

  assert.match(result, /^You have three contracts\./);
  assert.match(result, /- Product A/);
  assert.match(result, /- Product B/);
  assert.match(result, /- Product C/);
  assert.doesNotMatch(result, /PRODUCT A/);
});
