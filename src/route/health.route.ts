import { Router } from "express";

import { serviceContainer } from "../config/index.js";
import { HealthController } from "../controller/index.js";

/** Router exposing backend health endpoints. */
const router = Router();
const healthController = serviceContainer.get(HealthController);
// This router is mounted at /health in app.ts, so its root handles GET /health.
router.get("/", healthController.healthCheck);

export default router;
