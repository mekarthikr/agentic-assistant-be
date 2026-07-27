/** Validated backend configuration. */
export interface AppEnvironment {
  PORT: number;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  ENTERPRISE_API_BASE_URL: string;
  ENTERPRISE_API_DOC_PATH: string;
  ENTERPRISE_RAG_INDEX_PATH: string;
  SOCKET_AUTH_TOKEN?: string;
  WS_PATH: string;
  WS_MAX_PAYLOAD_BYTES: number;
  CHAT_MAX_MESSAGE_LENGTH: number;
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX: number;
}
