import { injectable } from "inversify";

import type { HealthStatus } from "../types/index.js";

/** Provides application health information independently of the HTTP layer. */
@injectable()
export class HealthService {
  /** Creates the current backend health response. */
  public getHealthStatus(): HealthStatus {
    return {
      success: true,
      message: "Backend is running.",
      timestamp: new Date().toISOString(),
    };
  }
}
