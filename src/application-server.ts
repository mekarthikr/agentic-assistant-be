import { createServer, type Server as HttpServer } from "node:http";

import { env, groqConfiguration } from "@app/config";
import { GroqProvider } from "@app/providers";
import {
  AIOrchestrator,
  ConversationService,
  EnterpriseRagService,
  ToolRegistry,
} from "@app/service";
import { ChatSocketServer } from "@app/socket";
import { createEnterpriseTools } from "@app/tools/enterprise-tools";
import app from "@app/app";

export interface ApplicationServer {
  httpServer: HttpServer;
  socketServer: ChatSocketServer;
}

/** Creates the HTTP and WebSocket server without binding it to a port. */
export const createApplicationServer = async (): Promise<ApplicationServer> => {
  const httpServer = createServer(app);
  const conversationService = new ConversationService();
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

  return { httpServer, socketServer };
};
