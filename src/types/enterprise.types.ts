export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
}

export interface EnterpriseEndpointParameter {
  name: string;
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

export interface Contract {
  contractNumber: string;
  clientName: string;
  productName: string;
  issuedDate: string;
  currentValue: number;
  anniversaryDate: string;
  taxType: string;
  contractStatus: string;
  taxQualification: string;
  distributionCompany: string;
}

export interface Application {
  clientName: string;
  product: string;
  anticipatedPremium: number;
  startDate: string;
  taxType: string;
  status: string;
  contractNumber: string;
  productId: string;
  agentNumber: string;
  applicationLink: string;
  contactId: string;
  applicationName: string;
}

export class EnterpriseApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "EnterpriseApiError";
  }
}
