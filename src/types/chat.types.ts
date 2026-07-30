import type { WebSocket, RawData } from "ws";

interface AuthMessage {
  type: "auth";
  token: string;
}

interface ChatSendMessage {
  type: "chat.send";
  requestId: string;
  conversationId: string;
  message: string;
  userType: "agent" | "client";
}

interface ChatCancelMessage {
  type: "chat.cancel";
  requestId: string;
}

interface PingMessage {
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
