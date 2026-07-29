import type { WebSocket, RawData } from "ws";

export interface AuthMessage {
  type: "auth";
  token: string;
}

export interface ChatSendMessage {
  type: "chat.send";
  requestId: string;
  conversationId: string;
  message: string;
  userType: "agent" | "client";
}

export interface ChatCancelMessage {
  type: "chat.cancel";
  requestId: string;
}

export interface PingMessage {
  type: "ping";
  timestamp: number;
}

export type ClientMessage =
  AuthMessage | ChatSendMessage | ChatCancelMessage | PingMessage;

export interface ChatRequest {
  conversationId: string;
  message: string;
  signal: AbortSignal;
}

/**
 * Produces a complete or streaming assistant response for a chat request.
 *
 * @param request - Validated chat input and its cancellation signal.
 * @returns A complete response or asynchronous stream of response chunks.
 */
export type ChatHandler = (
  request: ChatRequest,
) => Promise<string> | AsyncIterable<string>;

export type LiveSocket = WebSocket & {
  isAlive: boolean;
  isAuthenticated: boolean;
  requestCount: number;
  requestWindowStartedAt: number;
};

export type WebSocketRawData = RawData;
