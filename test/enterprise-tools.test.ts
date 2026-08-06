import assert from "node:assert/strict";
import test from "node:test";

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
  {
    contractNumber: "1561104",
    clientName: "SMITH JOHN",
    productName: "Product D",
    issuedDate: "2025-09-15T05:00:00+00:00",
    currentValue: 25000,
    anniversaryDate: "2027-09-15T05:00:00+00:00",
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

test("client contract searches use the client name and return every matching contract", async () => {
  let receivedFilters: Record<string, string | undefined> | undefined;
  const searchContracts = createEnterpriseTools({
    getContracts: async (filters: Record<string, string | undefined>) => {
      receivedFilters = filters;
      return {
        success: true,
        message: "Request successful",
        data: contracts.filter(({ clientName }) => clientName === "SMITH JOHN"),
        timestamp: "2026-08-04T00:00:00.000Z",
      };
    },
  } as never).find(({ name }) => name === "searchContracts");

  const response = (await searchContracts?.execute({}, {
    toolCallId: "client-contract-search",
    userType: "client",
    clientName: "SMITH JOHN",
    clientApplicationContractNumber: "1561092",
  })) as ApiResponse<Contract[]>;

  assert.equal(receivedFilters?.clientName, "SMITH JOHN");
  assert.deepEqual(
    response.data.map(({ contractNumber }) => contractNumber),
    ["1561092", "1561104"],
  );
});
