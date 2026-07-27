import { jsonSchema } from "ai";

import { EnterpriseApiProvider } from "../providers/index.js";
import type { ApplicationTool } from "../service/index.js";
import type { EnterpriseEndpoint } from "../types/index.js";

type ToolInput = Record<string, unknown>;

const toStringInput = (
  input: unknown,
  endpoint: EnterpriseEndpoint,
): Record<string, string> => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }

  const record = input as ToolInput;
  return Object.fromEntries(
    endpoint.parameters.flatMap((parameter) => {
      const value = record[parameter.name];
      if (parameter.required && (typeof value !== "string" || !value.trim())) {
        throw new Error(`${parameter.name} is required.`);
      }
      return typeof value === "string" && value.trim()
        ? [[parameter.name, value.trim()]]
        : [];
    }),
  );
};

/** Generates read-only tools directly from operations parsed from the API docs. */
export const createEnterpriseTools = (
  endpoints: readonly EnterpriseEndpoint[],
  enterpriseApi = new EnterpriseApiProvider(),
): ApplicationTool[] =>
  endpoints
    .filter(({ method }) => method === "GET")
    .map((endpoint) => ({
      name: endpoint.id,
      description: `${endpoint.description} Documented endpoint: ${endpoint.method} ${endpoint.path}.`,
      inputSchema: jsonSchema({
        type: "object",
        properties: Object.fromEntries(
          endpoint.parameters.map((parameter) => [
            parameter.name,
            {
              type: "string",
              description: parameter.description,
            },
          ]),
        ),
        required: endpoint.parameters
          .filter(({ required }) => required)
          .map(({ name }) => name),
        additionalProperties: false,
      }),
      execute: (input, { signal }) =>
        enterpriseApi.call(endpoint, toStringInput(input, endpoint), signal),
    }));
