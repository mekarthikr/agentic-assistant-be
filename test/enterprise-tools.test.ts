import assert from "node:assert/strict";
import test from "node:test";

import { AIOrchestrator } from "../src/service/ai-orchestrator.service";
import { createEnterpriseTools } from "../src/tools/enterprise-tools";
import type { ApiResponse, Contract } from "../src/types";

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
      throw new Error("Client contract searches must use the contracts list API.");
    },
  } as never).find(({ name }) => name === "searchContracts");

  const result = (await searchContracts?.execute({}, {
    toolCallId: "client-contracts-test",
    userType: "client",
    clientName: "SMITH ROBERT",
  })) as ApiResponse<Contract[]>;

  assert.equal(receivedFilters?.clientName, "SMITH ROBERT");
  assert.deepEqual(result.data, response.data);
});

test("routes client contract questions to the contract list only", () => {
  const orchestrator = new AIOrchestrator({} as never, {} as never, {} as never);
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
  assert.deepEqual(selectToolNames("What is my application status?", "client"), [
    "searchApplications",
  ]);
  assert.deepEqual(selectToolNames("What is my product name?", "client"), [
    "searchContracts",
  ]);
  assert.deepEqual(selectToolNames("What is my name?", "client"), []);
});
