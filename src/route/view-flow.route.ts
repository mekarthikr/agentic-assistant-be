import { Router } from "express";

import { flowTracer } from "@app/observability";
import { flowDashboardPage } from "./view-flow.page";

const router = Router();

/** Optionally protects the runtime dashboard with `FLOW_VIEW_TOKEN`. */
router.use((req, res, next) => {
  const configuredToken = process.env.FLOW_VIEW_TOKEN?.trim();
  if (!configuredToken) {
    next();
    return;
  }

  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const authorization = req.headers.authorization;
  const bearerToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (queryToken === configuredToken || bearerToken === configuredToken) {
    next();
    return;
  }

  res.status(401).type("text/plain").send("Unauthorized");
});

router.get("/", (_req, res) => {
  res
    .status(200)
    .set("Cache-Control", "no-store")
    .type("html")
    .send(flowDashboardPage);
});

router.get("/events", (req, res) => {
  res.status(200);
  res.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(
    `event: snapshot\ndata: ${JSON.stringify(flowTracer.snapshot())}\n\n`,
  );

  const unsubscribe = flowTracer.subscribe((event) => {
    res.write(`event: flow\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15_000);
  heartbeat.unref();

  req.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
