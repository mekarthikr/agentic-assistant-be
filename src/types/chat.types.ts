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

export type LiveSocket = WebSocket & {
  isAlive: boolean;
  isAuthenticated: boolean;
  requestCount: number;
  requestWindowStartedAt: number;
};

export type WebSocketRawData = RawData;
