import { env } from "@app/config";
import type { ApiResponse, Application, Contract } from "@app/types";
import { EnterpriseApiError as EnterpriseError } from "@app/types";

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
    } catch {
      signal?.throwIfAborted();
      throw new EnterpriseError(
        "The enterprise API could not be reached.",
        502,
      );
    }

    const payload = (await response
      .json()
      .catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !payload) {
      throw new EnterpriseError(
        payload?.message || "The enterprise API returned an invalid response.",
        response.status || 502,
      );
    }

    return payload;
  }
}
