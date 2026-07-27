import express from "express";
import cors from "cors";

import { healthRoutes } from "./route/index.js";

/** Configured Express application shared by the HTTP server and tests. */
const app = express();

app.disable("x-powered-by");

app.use(cors());

app.use(express.json());

app.use("/health", healthRoutes);

app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Route not found." });
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    void _next;

    if (error instanceof SyntaxError) {
      res.status(400).json({ success: false, message: "Invalid JSON body." });
      return;
    }

    console.error("Unhandled request error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  },
);

export default app;
