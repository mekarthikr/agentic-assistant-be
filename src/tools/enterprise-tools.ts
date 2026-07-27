import { jsonSchema } from "ai";

import { EnterpriseApiProvider } from "@app/providers";
import type { ApplicationTool } from "@app/service";
import type { EnterpriseEndpoint } from "@app/types";

type ToolInput = Record<string, unknown>;

/**
 * Validates unknown model input against the parameters parsed for an endpoint.
 *
 * @param input - Untrusted input produced by the model.
 * @param endpoint - Endpoint whose documented parameters are allowed.
 * @returns Trimmed string values for recognized parameters only.
 */
const toStringInput = (
  input: unknown,
  endpoint: EnterpriseEndpoint,
): Record<string, string> => {
  let normalizedInput = input;
  if (typeof normalizedInput === "string") {
    try {
      normalizedInput = normalizedInput.trim()
        ? JSON.parse(normalizedInput)
        : {};
    } catch {
      throw new Error("Tool input must be valid JSON.");
    }
  }
  if (normalizedInput === undefined || normalizedInput === null) {
    normalizedInput = {};
  }
  if (typeof normalizedInput !== "object" || Array.isArray(normalizedInput)) {
    throw new Error("Tool input must be an object.");
  }

  const record = normalizedInput as ToolInput;
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

/**
 * Generates executable read-only tools from parsed API operations.
 *
 * @param endpoints - Operations discovered in the enterprise documentation.
 * @param enterpriseApi - Provider responsible for the actual HTTP request.
 * @returns One application tool for each documented `GET` operation.
 */
export const createEnterpriseTools = (
  endpoints: readonly EnterpriseEndpoint[],
  enterpriseApi = new EnterpriseApiProvider(),
): ApplicationTool[] =>
  endpoints
    .filter(({ method }) => method === "GET")
    .map((endpoint) => ({
      name: endpoint.id,
      description: `${endpoint.description} Use this only as a native structured tool call with real values supplied by the insurance agent. Never expose the tool name, endpoint, JSON arguments, sample data, or placeholders in user-facing text. Documented endpoint: ${endpoint.method} ${endpoint.path}.`,
      inputSchema: jsonSchema({
        type: "object",
        properties: Object.fromEntries(
          endpoint.parameters.map((parameter) => [
            parameter.name,
            {
              type: parameter.type,
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
