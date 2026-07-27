import { env } from "@app/config";
import type {
  ApiResponse,
  EnterpriseEndpoint,
  EnterpriseEndpointParameter,
} from "@app/types";
import { EnterpriseApiError as EnterpriseError } from "@app/types";

/** HTTP client for the documented enterprise Contracts and Applications APIs. */
export class EnterpriseApiProvider {
  public async call(
    endpoint: EnterpriseEndpoint,
    input: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<ApiResponse<unknown>> {
    if (endpoint.method !== "GET") {
      throw new EnterpriseError(
        `The documented ${endpoint.method} operation is not enabled.`,
        405,
      );
    }
    if (
      !endpoint.path.startsWith("/") ||
      endpoint.path.includes("://") ||
      endpoint.path.includes("..")
    ) {
      throw new EnterpriseError(
        "The documented endpoint path is invalid.",
        400,
      );
    }

    let endpointPath = endpoint.path;
    for (const parameter of endpoint.parameters) {
      if (parameter.location !== "path") continue;
      const value = input[parameter.name];
      if (!value && parameter.required) {
        throw new EnterpriseError(`${parameter.name} is required.`, 400);
      }
      endpointPath = this.replacePathParameter(endpointPath, parameter, value);
    }

    const url = new URL(
      endpointPath.replace(/^\//, ""),
      `${env.ENTERPRISE_API_BASE_URL}/`,
    );
    for (const parameter of endpoint.parameters) {
      const value = input[parameter.name]?.trim();
      if (parameter.location === "query" && value) {
        url.searchParams.set(parameter.name, value);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: endpoint.method,
        headers: { Accept: "application/json" },
        signal,
      });
    } catch {
      signal?.throwIfAborted();
      throw new EnterpriseError(
        "The enterprise API could not be reached.",
        502,
      );
    }

    const payload = (await response
      .json()
      .catch(() => null)) as ApiResponse<unknown> | null;
    if (!response.ok || !payload) {
      throw new EnterpriseError(
        payload?.message || "The enterprise API returned an invalid response.",
        response.status || 502,
      );
    }

    return payload;
  }

  private replacePathParameter(
    path: string,
    parameter: EnterpriseEndpointParameter,
    value: string | undefined,
  ): string {
    const encodedValue = encodeURIComponent(value?.trim() || "");
    return path
      .replace(`:${parameter.name}`, encodedValue)
      .replace(`{${parameter.name}}`, encodedValue);
  }
}
