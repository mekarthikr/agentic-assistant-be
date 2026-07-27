import { Router } from "express";

/** Router exposing backend health endpoints. */
const router = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend is running.",
    timestamp: new Date().toISOString(),
  });
});

export default router;
