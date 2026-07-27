import { Router } from "express";

import { serviceContainer } from "../config/index.js";
import { HealthController } from "../controller/index.js";

/** Router exposing backend health endpoints. */
const router = Router();
const healthController = serviceContainer.get(HealthController);
router.get("/", healthController.healthCheck);

export default router;
