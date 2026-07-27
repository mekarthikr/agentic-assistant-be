import dotenv from "dotenv";
import path from "node:path";

import type { AppEnvironment } from "@app/types";

dotenv.config();

/**
 * Reads a required environment variable and rejects empty values at startup.
 *
 * @param name - Environment variable name.
 * @returns The trimmed configured value.
 */
const requireEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be configured before the server starts.`);
  }
  return value;
};

const socketAuthToken = process.env.SOCKET_AUTH_TOKEN;

/** Validated runtime configuration consumed by the HTTP and WebSocket servers. */
export const env: AppEnvironment = {
  PORT: Number(process.env.PORT || "5000"),
  GROQ_API_KEY: requireEnvironmentVariable("GROQ_API_KEY"),
  GROQ_MODEL: process.env.GROQ_MODEL?.trim() || "llama-3.1-8b-instant",
  ENTERPRISE_API_BASE_URL:
    process.env.ENTERPRISE_API_BASE_URL?.trim() ||
    "https://mock-api-server-zeta.vercel.app/api/v1",
  ENTERPRISE_API_DOC_PATH: path.resolve(
    process.cwd(),
    process.env.ENTERPRISE_API_DOC_PATH?.trim() ||
      "src/docs/enterprise-api-documentation.md",
  ),
  ENTERPRISE_RAG_INDEX_PATH: path.resolve(
    process.cwd(),
    process.env.ENTERPRISE_RAG_INDEX_PATH?.trim() ||
      "src/rag/enterprise-api-index.json",
  ),
  SOCKET_AUTH_TOKEN: socketAuthToken,
  WS_PATH: process.env.WS_PATH || "/ws",
  WS_MAX_PAYLOAD_BYTES: 64 * 1024,
  CHAT_MAX_MESSAGE_LENGTH: 1_000,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 30,
};
