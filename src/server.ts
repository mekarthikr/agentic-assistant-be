import { env, groqConfiguration, serviceContainer } from "@app/config";
import { GroqProvider } from "@app/providers";
import {
  AIOrchestrator,
  ConversationService,
  ToolRegistry,
} from "@app/service";
import { createServer } from "http";
import { NodeChatSocketServer } from "@app/socket";
import { createEnterpriseTools } from "@app/tools/enterprise-tools";
import { logError } from "@app/utils/error-logger";
import app from "./app";

const httpServer = createServer(app);
const conversationService = serviceContainer.get(ConversationService);
const provider = new GroqProvider(groqConfiguration);
const toolRegistry = new ToolRegistry(createEnterpriseTools());
const orchestrator = new AIOrchestrator(
  conversationService,
  provider,
  toolRegistry,
);
const socketServer = new NodeChatSocketServer(httpServer, orchestrator);

httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 35_000;
httpServer.keepAliveTimeout = 5_000;

httpServer.listen(env.PORT, () => {
  console.log(`Server started on port ${env.PORT}`);
});

httpServer.on("error", (error) => {
  logError("HTTP server failed", error, { port: env.PORT });
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
        logError(
          "Error while closing server",
          socketError ?? httpError,
          { signal },
        );
        process.exitCode = 1;
      }

      console.log("Server closed.");
    });
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
