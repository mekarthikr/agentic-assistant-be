import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { env } from "@app/config";
import { flowTracer } from "@app/observability";
import { AIOrchestrator } from "@app/service";
import type { ClientMessage, LiveSocket, WebSocketRawData } from "@app/types";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Sends a JSON payload only while the client connection is open. */
const sendJson = (socket: WebSocket, payload: object): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

/** Parses every supported `ws` raw-data representation as a client message. */
const parseMessage = (data: WebSocketRawData): ClientMessage | null => {
  try {
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : data instanceof ArrayBuffer
        ? Buffer.from(data)
        : Buffer.from(data);
    return JSON.parse(buffer.toString("utf8")) as ClientMessage;
  } catch {
    return null;
  }
};

/** Counts messages in the current window and reports whether its limit is exceeded. */
const isRateLimited = (socket: LiveSocket): boolean => {
  const now = Date.now();

  if (now - socket.requestWindowStartedAt >= env.RATE_LIMIT_WINDOW_MS) {
    socket.requestWindowStartedAt = now;
    socket.requestCount = 0;
  }

  socket.requestCount += 1;
  return socket.requestCount > env.RATE_LIMIT_MAX;
};

/**
 * Owns the WebSocket chat transport attached to an existing HTTP server.
 *
 * The server authenticates clients, streams chat responses, tracks cancellable
 * requests, rate-limits messages, and removes unresponsive connections with
 * heartbeat checks.
 */
export class ChatSocketServer {
  private readonly socketServer: WebSocketServer;
  private readonly activeRequests = new WeakMap<
    LiveSocket,
    Map<string, AbortController>
  >();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly upgradeTraces = new WeakMap<IncomingMessage, string>();

  /**
   * Creates and attaches the WebSocket server.
   *
   * @param httpServer - HTTP server that receives WebSocket upgrade requests.
   * @param orchestrator - Service used to coordinate conversation and AI work.
   */
  public constructor(
    private readonly httpServer: HttpServer,
    private readonly orchestrator: AIOrchestrator,
  ) {
    this.socketServer = new WebSocketServer({
      noServer: true,
      maxPayload: env.WS_MAX_PAYLOAD_BYTES,
    });

    this.httpServer.on("upgrade", this.handleUpgrade);
    this.socketServer.on("connection", this.handleConnection);

    this.heartbeat = setInterval(this.checkConnections, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  /** Upgrades a matching HTTP request to WebSocket transport. */
  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const traceId = randomUUID();
    this.upgradeTraces.set(request, traceId);
    flowTracer.record({
      stage: "websocket",
      action: "websocket.upgrade.received",
      summary: `WebSocket upgrade requested for ${requestUrl.pathname}.`,
      context: { traceId, transport: "websocket" },
      details: { path: requestUrl.pathname },
    });

    if (requestUrl.pathname !== env.WS_PATH) {
      flowTracer.record({
        stage: "websocket",
        level: "decision",
        action: "websocket.upgrade.rejected",
        summary:
          "The upgrade path did not match the configured WebSocket path.",
        context: { traceId, transport: "websocket" },
        details: {
          requestedPath: requestUrl.pathname,
          expectedPath: env.WS_PATH,
        },
      });
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      flowTracer.record({
        stage: "websocket",
        level: "success",
        action: "websocket.upgrade.accepted",
        summary: "The HTTP connection was upgraded to WebSocket.",
        context: { traceId, transport: "websocket" },
      });
      this.socketServer.emit("connection", webSocket, request);
    });
  };

  /** Initializes state and event handlers for a connected client. */
  private readonly handleConnection = (
    webSocket: WebSocket,
    request: IncomingMessage,
  ): void => {
    const socket = webSocket as LiveSocket;
    socket.flowTraceId = this.upgradeTraces.get(request) ?? randomUUID();
    socket.isAlive = true;
    socket.isAuthenticated = !env.SOCKET_AUTH_TOKEN;
    socket.requestCount = 0;
    socket.requestWindowStartedAt = Date.now();
    this.activeRequests.set(socket, new Map());
    flowTracer.record({
      stage: "websocket",
      level: "decision",
      action: "websocket.connection.initialized",
      summary: socket.isAuthenticated
        ? "WebSocket connection is ready without token authentication."
        : "WebSocket connection is waiting for authentication.",
      context: { traceId: socket.flowTraceId, transport: "websocket" },
      details: { authenticationRequired: Boolean(env.SOCKET_AUTH_TOKEN) },
    });

    const authTimer = setTimeout(() => {
      if (!socket.isAuthenticated) {
        flowTracer.record({
          stage: "websocket",
          level: "error",
          action: "websocket.auth.timeout",
          summary: "WebSocket authentication timed out.",
          context: { traceId: socket.flowTraceId, transport: "websocket" },
        });
        socket.close(1008, "Authentication timed out");
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref();

    if (socket.isAuthenticated) {
      sendJson(socket, {
        type: "connection.ready",
        connectionId: randomUUID(),
      });
    }

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (data, isBinary) => {
      void this.handleMessage(socket, data, isBinary, authTimer);
    });

    socket.once("close", () => {
      clearTimeout(authTimer);
      this.abortActiveRequests(socket, "The client disconnected.");
      flowTracer.record({
        stage: "websocket",
        action: "websocket.connection.closed",
        summary: "The WebSocket client disconnected.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
      });
    });

    socket.on("error", (error) => {
      flowTracer.record({
        stage: "websocket",
        level: "error",
        action: "websocket.connection.error",
        summary: "The WebSocket connection emitted an error.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
        details: { error },
      });
      console.error("WebSocket connection error:", error.message);
    });
  };

  /**
   * Validates and routes a message received from an authenticated client.
   *
   * @param socket - Client connection that sent the message.
   * @param data - Raw WebSocket message payload.
   * @param isBinary - Whether the payload was sent as binary data.
   * @param authTimer - Authentication deadline associated with the connection.
   */
  private async handleMessage(
    socket: LiveSocket,
    data: WebSocketRawData,
    isBinary: boolean,
    authTimer: NodeJS.Timeout,
  ): Promise<void> {
    if (isBinary) {
      flowTracer.record({
        stage: "websocket",
        level: "decision",
        action: "websocket.message.rejected",
        summary: "A binary WebSocket message was rejected.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
      });
      socket.close(1003, "Binary messages are not supported");
      return;
    }

    const payload = parseMessage(data);
    if (!payload || typeof payload.type !== "string") {
      flowTracer.record({
        stage: "websocket",
        level: "error",
        action: "websocket.message.invalid",
        summary: "A WebSocket message failed JSON or shape validation.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
      });
      sendJson(socket, {
        type: "chat.error",
        code: "INVALID_MESSAGE",
        message: "A valid JSON message is required.",
      });
      return;
    }
    flowTracer.record({
      stage: "websocket",
      action: "websocket.message.received",
      summary: `Received WebSocket message "${payload.type}".`,
      context: { traceId: socket.flowTraceId, transport: "websocket" },
      details: { messageType: payload.type },
    });

    if (!socket.isAuthenticated) {
      if (payload.type !== "auth" || payload.token !== env.SOCKET_AUTH_TOKEN) {
        flowTracer.record({
          stage: "websocket",
          level: "decision",
          action: "websocket.auth.rejected",
          summary: "WebSocket authentication failed.",
          context: { traceId: socket.flowTraceId, transport: "websocket" },
        });
        socket.close(1008, "Unauthorized");
        return;
      }

      socket.isAuthenticated = true;
      clearTimeout(authTimer);
      flowTracer.record({
        stage: "websocket",
        level: "success",
        action: "websocket.auth.accepted",
        summary: "WebSocket authentication succeeded.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
      });
      sendJson(socket, {
        type: "connection.ready",
        connectionId: randomUUID(),
      });
      return;
    }

    if (payload.type === "ping") {
      flowTracer.record({
        stage: "websocket",
        action: "websocket.ping.responded",
        summary: "Application ping was answered with pong.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
      });
      sendJson(socket, { type: "pong", timestamp: payload.timestamp });
      return;
    }

    if (payload.type === "chat.cancel") {
      const activeRequests = this.activeRequests.get(socket);
      const controller = activeRequests?.get(payload.requestId);
      controller?.abort(new Error("The client cancelled the chat request."));
      activeRequests?.delete(payload.requestId);
      flowTracer.record({
        stage: "conversation",
        level: "decision",
        action: "chat.cancel.requested",
        summary: controller
          ? "The active chat request was cancelled."
          : "No active request matched the cancellation.",
        context: {
          traceId: socket.flowTraceId,
          transport: "websocket",
          requestId: payload.requestId,
        },
        details: { activeRequestFound: Boolean(controller) },
      });
      return;
    }

    if (payload.type !== "chat.send") {
      sendJson(socket, {
        type: "chat.error",
        code: "UNSUPPORTED_MESSAGE",
        message: "Unsupported message type.",
      });
      return;
    }

    const requestId = payload.requestId?.trim();
    const conversationId = payload.conversationId?.trim();
    const message = payload.message?.trim();

    if (!requestId || !conversationId || !message) {
      flowTracer.record({
        stage: "websocket",
        level: "decision",
        action: "chat.message.rejected",
        summary: "A chat request failed required-field validation.",
        context: { traceId: socket.flowTraceId, transport: "websocket" },
        details: {
          hasRequestId: Boolean(requestId),
          hasConversationId: Boolean(conversationId),
          hasMessage: Boolean(message),
        },
      });
      sendJson(socket, {
        type: "chat.error",
        requestId,
        code: "VALIDATION_ERROR",
        message: "requestId, conversationId, and message are required.",
      });
      return;
    }

    if (message.length > env.CHAT_MAX_MESSAGE_LENGTH) {
      flowTracer.record({
        stage: "websocket",
        level: "decision",
        action: "chat.message.too_long",
        summary: "A chat request exceeded the configured message limit.",
        context: {
          traceId: socket.flowTraceId,
          transport: "websocket",
          requestId,
          conversationId,
        },
        details: {
          messageLength: message.length,
          limit: env.CHAT_MAX_MESSAGE_LENGTH,
        },
      });
      sendJson(socket, {
        type: "chat.error",
        requestId,
        code: "MESSAGE_TOO_LONG",
        message: `Messages are limited to ${env.CHAT_MAX_MESSAGE_LENGTH} characters.`,
      });
      return;
    }

    if (isRateLimited(socket)) {
      flowTracer.record({
        stage: "websocket",
        level: "decision",
        action: "chat.message.rate_limited",
        summary: "A chat request was rejected by the connection rate limit.",
        context: {
          traceId: socket.flowTraceId,
          transport: "websocket",
          requestId,
          conversationId,
        },
        details: {
          requestCount: socket.requestCount,
          limit: env.RATE_LIMIT_MAX,
        },
      });
      sendJson(socket, {
        type: "chat.error",
        requestId,
        code: "RATE_LIMITED",
        message: "Too many messages. Please wait before trying again.",
      });
      return;
    }

    const abortController = new AbortController();
    this.activeRequests.get(socket)?.set(requestId, abortController);
    sendJson(socket, { type: "chat.started", requestId, conversationId });

    await flowTracer.withContext(
      {
        traceId: socket.flowTraceId,
        transport: "websocket",
        requestId,
        conversationId,
      },
      async () => {
        try {
          flowTracer.record({
            stage: "conversation",
            action: "chat.request.accepted",
            summary: "The chat request entered AI orchestration.",
            details: { message, messageLength: message.length },
          });
          const result = this.orchestrator.streamChat(conversationId, message, {
            signal: abortController.signal,
          });

          for await (const delta of result) {
            sendJson(socket, {
              type: "chat.delta",
              requestId,
              conversationId,
              delta,
            });
            flowTracer.record({
              stage: "response",
              action: "chat.delta.sent",
              summary: "An assistant response chunk was sent to the client.",
              details: { chunkLength: delta.length },
            });
          }

          if (!abortController.signal.aborted) {
            sendJson(socket, {
              type: "chat.complete",
              requestId,
              conversationId,
              createdAt: new Date().toISOString(),
            });
            flowTracer.record({
              stage: "response",
              level: "success",
              action: "chat.response.completed",
              summary: "The completed response was sent to the client.",
            });
          }
        } catch (error) {
          if (abortController.signal.aborted) return;

          flowTracer.record({
            stage: "response",
            level: "error",
            action: "chat.response.failed",
            summary: "The chat handler failed.",
            details: { error },
          });
          console.error("Chat handler failed", {
            requestId,
            error: error instanceof Error ? error.message : error,
          });
          sendJson(socket, {
            type: "chat.error",
            requestId,
            code: "CHAT_FAILED",
            message: "Unable to process the chat message.",
          });
        } finally {
          this.removeActiveRequest(socket, requestId, abortController);
        }
      },
    );
  }

  /** Aborts every in-flight request associated with a disconnected client. */
  private abortActiveRequests(socket: LiveSocket, reason: string): void {
    const activeRequests = this.activeRequests.get(socket);
    if (!activeRequests) return;

    for (const controller of activeRequests.values()) {
      controller.abort(new Error(reason));
    }

    activeRequests.clear();
    this.activeRequests.delete(socket);
  }

  /** Removes a request only when its controller is still the active instance. */
  private removeActiveRequest(
    socket: LiveSocket,
    requestId: string,
    controller: AbortController,
  ): void {
    const activeRequests = this.activeRequests.get(socket);
    if (activeRequests?.get(requestId) === controller) {
      activeRequests.delete(requestId);
    }
  }

  /** Pings healthy clients and terminates connections that missed a heartbeat. */
  private readonly checkConnections = (): void => {
    for (const webSocket of this.socketServer.clients) {
      const socket = webSocket as LiveSocket;
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  };

  /**
   * Stops heartbeats, detaches upgrade handling, and closes client connections.
   *
   * @param callback - Invoked when the underlying WebSocket server has closed.
   */
  public close(callback?: (error?: Error) => void): void {
    clearInterval(this.heartbeat);
    this.httpServer.off("upgrade", this.handleUpgrade);

    for (const socket of this.socketServer.clients) {
      socket.close(1001, "Server shutting down");
    }

    this.socketServer.close(callback);
  }
}
