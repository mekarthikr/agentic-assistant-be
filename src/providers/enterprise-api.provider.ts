import { env } from "@app/config";
import type { ApiResponse, Application, Contract } from "@app/types";
import { EnterpriseApiError as EnterpriseError } from "@app/types";
import { logError } from "@app/utils/error-logger";

type QueryParameters = Record<string, string | undefined>;

/** HTTP client for the documented enterprise Contracts and Applications APIs. */
export class EnterpriseApiProvider {
  public getContracts(
    filters: QueryParameters,
    signal?: AbortSignal,
  ): Promise<ApiResponse<Contract[]>> {
    return this.request<Contract[]>("contracts", filters, signal);
  }

  public getContract(
    contractNumber: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<Contract>> {
    return this.request<Contract>(
      `contracts/${encodeURIComponent(contractNumber)}`,
      {},
      signal,
    );
  }

  public getApplications(
    filters: QueryParameters,
    signal?: AbortSignal,
  ): Promise<ApiResponse<Application[]>> {
    return this.request<Application[]>("applications", filters, signal);
  }

  public getApplication(
    contractNumber: string,
    signal?: AbortSignal,
  ): Promise<ApiResponse<Application>> {
    return this.request<Application>(
      `applications/${encodeURIComponent(contractNumber)}`,
      {},
      signal,
    );
  }

  private async request<T>(
    path: string,
    parameters: QueryParameters = {},
    signal?: AbortSignal,
  ): Promise<ApiResponse<T>> {
    const url = new URL(path, `${env.ENTERPRISE_API_BASE_URL}/`);
    for (const [name, value] of Object.entries(parameters)) {
      if (value?.trim()) url.searchParams.set(name, value.trim());
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      logError("Enterprise API request failed", error, {
        method: "GET",
        url: url.toString(),
      });
      throw new EnterpriseError(
        "The enterprise API could not be reached.",
        502,
        error,
      );
    }

    let payload: ApiResponse<T> | null;
    try {
      payload = (await response.json()) as ApiResponse<T>;
    } catch (error) {
      logError("Enterprise API response JSON parsing failed", error, {
        method: "GET",
        url: url.toString(),
        statusCode: response.status,
      });
      throw new EnterpriseError(
        "The enterprise API returned an invalid response.",
        response.status || 502,
        error,
      );
    }

    if (!response.ok || !payload) {
      const error = new EnterpriseError(
        payload?.message || "The enterprise API returned an invalid response.",
        response.status || 502,
      );
      logError("Enterprise API returned an unsuccessful response", error, {
        method: "GET",
        url: url.toString(),
        statusCode: response.status,
        response: payload,
      });
      throw error;
    }

    return payload;
  }
}
