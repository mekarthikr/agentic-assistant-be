import dotenv from "dotenv";

import type { AppEnvironment } from "@app/types";

dotenv.config();

const requireEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured before the server starts.`);
  }
  return value;
};

const socketAuthToken = process.env.SOCKET_AUTH_TOKEN;
const DEFAULT_GROQ_CONTEXT_WINDOW = 131_072;

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/** Validated runtime configuration consumed by the HTTP and WebSocket servers. */
export const env: AppEnvironment = {
  PORT: Number(process.env.PORT || "5000"),
  GROQ_API_KEY: requireEnvironmentVariable("GROQ_API_KEY"),
  GROQ_MODEL: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
  GROQ_MODEL_CONTEXT_WINDOW: parsePositiveInteger(
    process.env.GROQ_MODEL_CONTEXT_WINDOW,
    DEFAULT_GROQ_CONTEXT_WINDOW,
  ),
  ENTERPRISE_API_BASE_URL:
    process.env.ENTERPRISE_API_BASE_URL?.trim() ||
    "https://mock-api-server-zeta.vercel.app/api/v1",
  SOCKET_AUTH_TOKEN: socketAuthToken,
  WS_PATH: process.env.WS_PATH || "/ws",
  WS_MAX_PAYLOAD_BYTES: 64 * 1024,
  CHAT_MAX_MESSAGE_LENGTH: 1_000,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 30,
};
