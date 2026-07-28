/** Validated backend configuration. */
export interface AppEnvironment {
  PORT: number;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  GROQ_MODEL_CONTEXT_WINDOW: number;
  ENTERPRISE_API_BASE_URL: string;
  SOCKET_AUTH_TOKEN?: string;
  WS_PATH: string;
  WS_MAX_PAYLOAD_BYTES: number;
  CHAT_MAX_MESSAGE_LENGTH: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}
