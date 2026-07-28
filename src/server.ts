import { createApplicationServer } from "@app/application-server";
import { env } from "@app/config";

const { httpServer, socketServer } = await createApplicationServer();

httpServer.listen(env.PORT, () => {
  console.log(`Server started on port ${env.PORT}`);
});

httpServer.on("error", (error) => {
  console.error("HTTP server failed:", error);
  process.exitCode = 1;
});

let isShuttingDown = false;

/**
 * Gracefully stops WebSocket and HTTP traffic for a process signal.
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

  socketServer.close((socketError) => {
    httpServer.close((httpError) => {
      clearTimeout(forceShutdownTimer);

      if (socketError || httpError) {
        console.error("Error while closing server:", socketError ?? httpError);
        process.exitCode = 1;
      }

      console.log("Server closed.");
    });
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
