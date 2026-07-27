import { env } from "./config/index.js";
import app from "./app.js";

const server = app.listen(env.PORT, () => {
  console.log(`Server started on port ${env.PORT}`);
});

server.on("error", (error) => {
  console.error("HTTP server failed:", error);
  process.exitCode = 1;
});

let isShuttingDown = false;

/**
 * Gracefully stops HTTP traffic for a process signal.
 *
 * @param signal - Signal that initiated the shutdown.
 */
const shutdown = (signal: NodeJS.Signals): void => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received. Closing server...`);

  const forceShutdownTimer = setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    process.exit(1);
  }, 10_000);
  forceShutdownTimer.unref();

  server.close((error) => {
    clearTimeout(forceShutdownTimer);

    if (error) {
      console.error("Error while closing server:", error);
      process.exitCode = 1;
    }

    console.log("Server closed.");
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
