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

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Validated runtime configuration consumed by the HTTP server. */
export const env: AppEnvironment = {
  PORT: Number(process.env.PORT || "5000"),
  GROQ_API_KEY: requireEnvironmentVariable("GROQ_API_KEY"),
  GROQ_MODEL: requireEnvironmentVariable("GROQ_MODEL"),
  CORS_ORIGINS: corsOrigins,
  CHAT_MAX_MESSAGE_LENGTH: 1_000,
  CHAT_MAX_HISTORY_MESSAGES: 50,
};
