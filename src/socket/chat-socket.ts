import { randomUUID } from "node:crypto";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";

import { env } from "@app/config";
import { AIOrchestrator } from "@app/service";
import {
  getRetryAfterMs,
  isRateLimitError,
  isTokenLimitError,
  type ClientMessage,
  type LiveSocket,
  type WebSocketRawData,
} from "@app/types";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const sendJson = (socket: WebSocket, payload: object): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

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

const getLocalRetryAfterMs = (socket: LiveSocket): number | undefined => {
  const now = Date.now();

  if (now - socket.requestWindowStartedAt >= env.RATE_LIMIT_WINDOW_MS) {
    socket.requestWindowStartedAt = now;
    socket.requestCount = 0;
  }

  socket.requestCount += 1;
  if (socket.requestCount <= env.RATE_LIMIT_MAX) return undefined;
  return Math.max(
    1,
    socket.requestWindowStartedAt + env.RATE_LIMIT_WINDOW_MS - now,
  );
};

const formatRetryMessage = (retryAfterMs?: number): string =>
  retryAfterMs === undefined
    ? "Too many requests. Please wait before trying again."
    : `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1_000)} seconds.`;

/**
 * Owns the WebSocket chat transport attached to an existing HTTP server.
 *
 * The server authenticates clients, streams chat responses, tracks cancellable
 * requests, rate-limits messages, and removes unresponsive connections with
 * heartbeat checks.
 */
export class ChatSocketServer {
  private readonly connections = new Set<LiveSocket>();
  private readonly activeRequests = new WeakMap<
    LiveSocket,
    Map<string, AbortController>
  >();
  private readonly heartbeat: NodeJS.Timeout;

  /**
   * Creates a WebSocket connection handler.
   *
   * @param orchestrator - Service used to coordinate conversation and AI work.
   */
  public constructor(private readonly orchestrator: AIOrchestrator) {
    this.heartbeat = setInterval(this.checkConnections, HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref();
  }

  /** Initializes state and event handlers for a connected client. */
  public readonly accept = (webSocket: WebSocket): void => {
    const socket = webSocket as LiveSocket;
    this.connections.add(socket);
    socket.isAlive = true;
    socket.isAuthenticated = !env.SOCKET_AUTH_TOKEN;
    socket.requestCount = 0;
    socket.requestWindowStartedAt = Date.now();
    this.activeRequests.set(socket, new Map());

    const authTimer = setTimeout(() => {
      if (!socket.isAuthenticated) {
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
      this.connections.delete(socket);
      this.abortActiveRequests(socket, "The client disconnected.");
    });

    socket.on("error", (error) => {
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
      socket.close(1003, "Binary messages are not supported");
      return;
    }

    const payload = parseMessage(data);
    if (!payload || typeof payload.type !== "string") {
      sendJson(socket, {
        type: "chat.error",
        code: "INVALID_MESSAGE",
        message: "A valid JSON message is required.",
      });
      return;
    }

    if (!socket.isAuthenticated) {
      if (payload.type !== "auth" || payload.token !== env.SOCKET_AUTH_TOKEN) {
        socket.close(1008, "Unauthorized");
        return;
      }

      socket.isAuthenticated = true;
      clearTimeout(authTimer);
      sendJson(socket, {
        type: "connection.ready",
        connectionId: randomUUID(),
      });
      return;
    }

    if (payload.type === "ping") {
      sendJson(socket, { type: "pong", timestamp: payload.timestamp });
      return;
    }

    if (payload.type === "chat.cancel") {
      const activeRequests = this.activeRequests.get(socket);
      const controller = activeRequests?.get(payload.requestId);
      controller?.abort(new Error("The client cancelled the chat request."));
      activeRequests?.delete(payload.requestId);
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
      sendJson(socket, {
        type: "chat.error",
        requestId,
        code: "VALIDATION_ERROR",
        message: "requestId, conversationId, and message are required.",
      });
      return;
    }

    if (message.length > env.CHAT_MAX_MESSAGE_LENGTH) {
      sendJson(socket, {
        type: "chat.error",
        requestId,
        code: "MESSAGE_TOO_LONG",
        message: `Messages are limited to ${env.CHAT_MAX_MESSAGE_LENGTH} characters.`,
      });
      return;
    }

    const localRetryAfterMs = getLocalRetryAfterMs(socket);
    if (localRetryAfterMs !== undefined) {
      sendJson(socket, {
        type: "chat.error",
        requestId,
        code: "RATE_LIMITED",
        message: formatRetryMessage(localRetryAfterMs),
        retryable: true,
        retryAfterMs: localRetryAfterMs,
        retryAfterSeconds: Math.ceil(localRetryAfterMs / 1_000),
      });
      return;
    }

    const abortController = new AbortController();
    this.activeRequests.get(socket)?.set(requestId, abortController);
    sendJson(socket, { type: "chat.started", requestId, conversationId });

    try {
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
      }

      if (!abortController.signal.aborted) {
        sendJson(socket, {
          type: "chat.complete",
          requestId,
          conversationId,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (abortController.signal.aborted) return;

      const tokenLimitExceeded = isTokenLimitError(error);
      const rateLimited = !tokenLimitExceeded && isRateLimitError(error);
      const retryAfterMs = rateLimited ? getRetryAfterMs(error) : undefined;
      const errorCode = tokenLimitExceeded
        ? "TOKEN_LIMIT_EXCEEDED"
        : rateLimited
          ? "RATE_LIMITED"
        : "CHAT_FAILED";
      const errorMessage = tokenLimitExceeded
        ? "This conversation exceeded the AI token limit. Ask for a shorter answer or start a new conversation."
        : rateLimited
          ? formatRetryMessage(retryAfterMs)
          : "Unable to process the chat message.";

      const logContext = {
        requestId,
        conversationId,
        code: errorCode,
        retryAfterMs,
        error: error instanceof Error ? error.message : String(error),
      };
      if (tokenLimitExceeded) {
        console.warn("Chat token limit exceeded", logContext);
      } else if (rateLimited) {
        console.warn("Chat rate limited", logContext);
      } else {
        console.error("Chat handler failed", logContext);
      }

      sendJson(socket, {
        type: "chat.error",
        requestId,
        conversationId,
        code: errorCode,
        message: errorMessage,
        retryable: rateLimited,
        ...(retryAfterMs === undefined
          ? {}
          : {
              retryAfterMs,
              retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
            }),
      });
    } finally {
      this.removeActiveRequest(socket, requestId, abortController);
    }
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
    for (const socket of this.connections) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }

      socket.isAlive = false;
      socket.ping();
    }
  };

  /**
   * Stops heartbeats and closes client connections.
   *
   * @param callback - Invoked when the underlying WebSocket server has closed.
   */
  public close(callback?: (error?: Error) => void): void {
    clearInterval(this.heartbeat);

    for (const socket of this.connections) {
      socket.close(1001, "Server shutting down");
    }

    callback?.();
  }
}

/** Owns the native Node.js WebSocket upgrade listener used outside Vercel. */
export class NodeChatSocketServer extends ChatSocketServer {
  private readonly socketServer: WebSocketServer;

  public constructor(
    private readonly httpServer: HttpServer,
    orchestrator: AIOrchestrator,
  ) {
    super(orchestrator);
    this.socketServer = new WebSocketServer({
      noServer: true,
      maxPayload: env.WS_MAX_PAYLOAD_BYTES,
    });
    this.httpServer.on("upgrade", this.handleUpgrade);
    this.socketServer.on("connection", this.accept);
  }

  /** Upgrades a matching HTTP request to WebSocket transport. */
  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname !== env.WS_PATH) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      this.socketServer.emit("connection", webSocket, request);
    });
  };

  public override close(callback?: (error?: Error) => void): void {
    this.httpServer.off("upgrade", this.handleUpgrade);
    super.close();
    this.socketServer.close(callback);
  }
}
