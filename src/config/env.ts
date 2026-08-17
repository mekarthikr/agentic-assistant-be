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

const parseNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseCosineDistance = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = parseNumber(value, fallback);
  return parsed >= 0 && parsed <= 2 ? parsed : fallback;
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
    "https://mock-api-server-seven.vercel.app/api/v1",
  SOCKET_AUTH_TOKEN: socketAuthToken,
  WS_PATH: process.env.WS_PATH || "/ws",
  WS_MAX_PAYLOAD_BYTES: 64 * 1024,
  CHAT_MAX_MESSAGE_LENGTH: 1_000,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 30,
  CHROMA_HOST: process.env.CHROMA_HOST?.trim() || "localhost",
  CHROMA_PORT: parsePositiveInteger(process.env.CHROMA_PORT, 8000),
  CHROMA_SSL: process.env.CHROMA_SSL === "true",
  CHROMA_API_KEY: process.env.CHROMA_API_KEY?.trim() || undefined,
  CHROMA_COLLECTION: process.env.CHROMA_COLLECTION?.trim() || "documents",
  CHROMA_TENANT: process.env.CHROMA_TENANT?.trim() || undefined,
  CHROMA_DATABASE: process.env.CHROMA_DATABASE?.trim() || undefined,
  RAG_TOP_K: parsePositiveInteger(process.env.RAG_TOP_K, 5),
  RAG_EMBEDDING_MODEL:
    process.env.RAG_EMBEDDING_MODEL?.trim() || "openai/text-embedding-3-small",
  RAG_RELEVANCE_THRESHOLD: parseCosineDistance(
    process.env.RAG_RELEVANCE_THRESHOLD,
    0.45,
  ),
  RAG_CHUNK_SIZE: parsePositiveInteger(process.env.RAG_CHUNK_SIZE, 700),
  RAG_CHUNK_OVERLAP: parsePositiveInteger(process.env.RAG_CHUNK_OVERLAP, 100),
  RAG_MAX_UPLOAD_BYTES: parsePositiveInteger(
    process.env.RAG_MAX_UPLOAD_BYTES,
    10 * 1024 * 1024,
  ),
  RAG_DATABASE_PATH:
    process.env.RAG_DATABASE_PATH?.trim() ||
    (process.env.VERCEL
      ? "/tmp/agentic-assistant-documents.sqlite"
      : ".data/documents.sqlite"),
  RAG_DEFAULT_USER_ID:
    process.env.RAG_DEFAULT_USER_ID?.trim() || "local-development-user",
};
