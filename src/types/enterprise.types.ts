/** Standard response envelope returned by the enterprise API. */
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

/** Parameter metadata parsed from the enterprise Markdown documentation. */
export interface EnterpriseEndpointParameter {
  name: string;
  type: "string";
  location: "path" | "query";
  required: boolean;
  description: string;
}

/** API operation discovered from the enterprise Markdown documentation. */
export interface EnterpriseEndpoint {
  id: string;
  title: string;
  method: string;
  path: string;
  description: string;
  parameters: EnterpriseEndpointParameter[];
  documentation: string;
}

/** HTTP-style error raised while validating or calling an enterprise endpoint. */
export class EnterpriseApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "EnterpriseApiError";
  }
}
