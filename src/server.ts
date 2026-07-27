import { env, groqConfiguration, serviceContainer } from "./config/index.js";
import { GroqProvider } from "./providers/index.js";
import {
  AIOrchestrator,
  ConversationService,
  EnterpriseRagService,
  ToolRegistry,
} from "./service/index.js";
import { createServer } from "http";
import { ChatSocketServer } from "./socket/index.js";
import { createEnterpriseTools } from "./tools/enterprise-tools.js";
import app from "./app.js";

const httpServer = createServer(app);
const conversationService = serviceContainer.get(ConversationService);
const provider = new GroqProvider(groqConfiguration);
const enterpriseRag = await EnterpriseRagService.load(
  env.ENTERPRISE_API_DOC_PATH,
  env.ENTERPRISE_RAG_INDEX_PATH,
);
const toolRegistry = new ToolRegistry(
  createEnterpriseTools(enterpriseRag.getEndpoints()),
);
const orchestrator = new AIOrchestrator(
  conversationService,
  provider,
  toolRegistry,
  enterpriseRag,
);
const socketServer = new ChatSocketServer(httpServer, orchestrator);

httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 35_000;
httpServer.keepAliveTimeout = 5_000;

httpServer.on("error", (error) => {
  console.error("HTTP server failed:", error);
  process.exitCode = 1;
});

if (!process.env.VERCEL) {
  httpServer.listen(env.PORT, () => {
    console.log(`Server started on port ${env.PORT}`);
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
          console.error(
            "Error while closing server:",
            socketError ?? httpError,
          );
          process.exitCode = 1;
        }

        console.log("Server closed.");
      });
    });
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

/**
 * Vercel consumes the server export directly. Local development uses the
 * listener above, so both runtimes share the same Express and WebSocket graph.
 */
export default httpServer;
