/** Response returned by the backend health-check endpoint. */
export interface HealthStatus {
  success: boolean;
  message: string;
  timestamp: string;
}
