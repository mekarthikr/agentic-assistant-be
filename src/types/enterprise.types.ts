export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  timestamp: string;
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
  contactId: string;
  applicationName: string;
}

export class EnterpriseApiError extends Error {
  public constructor(
    message: string,
    public readonly statusCode: number,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "EnterpriseApiError";
  }
}
