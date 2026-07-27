import { env } from "@app/config";
import type {
  ApiResponse,
  EnterpriseEndpoint,
  EnterpriseEndpointParameter,
} from "@app/types";
import { EnterpriseApiError as EnterpriseError } from "@app/types";
import { flowTracer } from "@app/observability";

/** HTTP client for the documented enterprise Contracts and Applications APIs. */
export class EnterpriseApiProvider {
  /**
   * Calls one validated, read-only endpoint discovered from the API documentation.
   *
   * @param endpoint - Parsed endpoint definition that controls the request.
   * @param input - Validated path and query parameter values.
   * @param signal - Optional cancellation signal forwarded to `fetch`.
   * @returns The parsed enterprise API response.
   * @throws {EnterpriseError} When the endpoint or remote response is invalid.
   */
  public async call(
    endpoint: EnterpriseEndpoint,
    input: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<ApiResponse<unknown>> {
    if (endpoint.method !== "GET") {
      flowTracer.record({
        stage: "enterprise",
        level: "decision",
        action: "enterprise.request.blocked",
        summary: `Blocked non-read-only ${endpoint.method} enterprise operation.`,
        details: { method: endpoint.method, path: endpoint.path },
      });
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

    const configuredBaseUrl = new URL(`${env.ENTERPRISE_API_BASE_URL}/`);
    const configuredBasePath = configuredBaseUrl.pathname.replace(/\/+$/, "");
    const endpointAlreadyIncludesBasePath =
      configuredBasePath &&
      configuredBasePath !== "/" &&
      (endpointPath === configuredBasePath ||
        endpointPath.startsWith(`${configuredBasePath}/`));
    const url = endpointAlreadyIncludesBasePath
      ? new URL(endpointPath, configuredBaseUrl.origin)
      : new URL(endpointPath.replace(/^\//, ""), configuredBaseUrl.toString());
    for (const parameter of endpoint.parameters) {
      const value = input[parameter.name]?.trim();
      if (parameter.location === "query" && value) {
        url.searchParams.set(parameter.name, value);
      }
    }

    const finishRequest = flowTracer.start({
      stage: "enterprise",
      action: "enterprise.request.started",
      summary: `Calling ${endpoint.method} ${endpoint.path}.`,
      details: {
        toolName: endpoint.id,
        method: endpoint.method,
        documentedPath: endpoint.path,
        input,
      },
    });
    let response: Response;
    try {
      response = await fetch(url, {
        method: endpoint.method,
        headers: { Accept: "application/json" },
        signal,
      });
    } catch {
      finishRequest({
        level: "error",
        action: "enterprise.request.unreachable",
        summary: "The enterprise API could not be reached.",
      });
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
      finishRequest({
        level: "error",
        action: "enterprise.request.failed",
        summary: `The enterprise API returned HTTP ${response.status}.`,
        details: { status: response.status, responseMessage: payload?.message },
      });
      throw new EnterpriseError(
        payload?.message || "The enterprise API returned an invalid response.",
        response.status || 502,
      );
    }

    finishRequest({
      level: "success",
      action: "enterprise.request.completed",
      summary: `The enterprise API returned HTTP ${response.status}.`,
      details: {
        status: response.status,
        success: payload.success,
        responseMessage: payload.message,
      },
    });
    return payload;
  }

  /**
   * Inserts a URL-encoded value into either supported path-parameter syntax.
   *
   * @param path - Documented endpoint path.
   * @param parameter - Path parameter metadata.
   * @param value - Raw value supplied by the tool call.
   * @returns The path with the named placeholder replaced.
   */
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
