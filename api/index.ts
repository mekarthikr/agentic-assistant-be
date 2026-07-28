import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { IncomingMessage, ServerResponse } from "node:http";

import app from "@app/app";
import { env, groqConfiguration, serviceContainer } from "@app/config";
import { GroqProvider } from "@app/providers";
import {
  AIOrchestrator,
  ConversationService,
  ToolRegistry,
} from "@app/service";
import { ChatSocketServer } from "@app/socket";
import { createEnterpriseTools } from "@app/tools/enterprise-tools";

const conversationService = serviceContainer.get(ConversationService);
const provider = new GroqProvider(groqConfiguration);
const toolRegistry = new ToolRegistry(createEnterpriseTools());
const orchestrator = new AIOrchestrator(
  conversationService,
  provider,
  toolRegistry,
);
const socketServer = new ChatSocketServer(orchestrator);

/**
 * Vercel Function entrypoint for HTTP traffic and WebSocket upgrades.
 *
 * Local Node.js development continues to use src/server.ts and its native
 * HTTP upgrade listener.
 */
export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");

  if (requestUrl.pathname !== env.WS_PATH) {
    app(request, response);
    return;
  }

  if (
    request.method !== "GET" ||
    request.headers.upgrade?.toLowerCase() !== "websocket"
  ) {
    response.statusCode = 426;
    response.setHeader("Upgrade", "websocket");
    response.end("WebSocket upgrade required.");
    return;
  }

  try {
    await experimental_upgradeWebSocket(socketServer.accept, {
      maxPayload: env.WS_MAX_PAYLOAD_BYTES,
    });
  } catch (error) {
    console.error("Vercel WebSocket upgrade failed:", error);

    if (!response.headersSent && !response.writableEnded) {
      response.statusCode = 500;
      response.end("WebSocket upgrade failed.");
    }
  }
}
