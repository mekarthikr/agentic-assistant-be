/** Validated backend configuration. */
export interface AppEnvironment {
  PORT: number;
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  CORS_ORIGINS: readonly string[];
  CHAT_MAX_MESSAGE_LENGTH: number;
  CHAT_MAX_HISTORY_MESSAGES: number;
}
