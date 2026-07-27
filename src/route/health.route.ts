import { Router } from "express";

import { serviceContainer } from "@app/config";
import { HealthController } from "@app/controller";

/** Router exposing backend health endpoints. */
const router = Router();
const healthController = serviceContainer.get(HealthController);
router.get("/", healthController.healthCheck);

export default router;
