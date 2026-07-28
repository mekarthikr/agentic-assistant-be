import type { Request, Response } from "express";
import { injectable } from "inversify";

import { HealthService } from "@app/service";
import { serviceContainer } from "@app/config";

/** Handles HTTP requests for backend health information. */
@injectable()
export class HealthController {
  /** Creates a health controller with its required service. */
  private readonly healthService: HealthService;
  constructor() {
    this.healthService = serviceContainer.get(HealthService);
  }

  /**
   * Returns the current backend health status.
   *
   * @param _req - Express request. No request data is required.
   * @param res - Express response used to return the health payload.
   */
  healthCheck = (_req: Request, res: Response): void => {
    res.status(200).json(this.healthService.getHealthStatus());
  };
}
