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
  CHROMA_HOST: string;
  CHROMA_PORT: number;
  CHROMA_SSL: boolean;
  CHROMA_API_KEY?: string;
  CHROMA_COLLECTION: string;
  CHROMA_TENANT?: string;
  CHROMA_DATABASE?: string;
  RAG_TOP_K: number;
  RAG_EMBEDDING_MODEL: string;
  /** Maximum cosine distance accepted as relevant. */
  RAG_RELEVANCE_THRESHOLD: number;
  RAG_CHUNK_SIZE: number;
  RAG_CHUNK_OVERLAP: number;
  RAG_MAX_UPLOAD_BYTES: number;
  RAG_DATABASE_PATH: string;
  /** Server-resolved identity for the existing single-token auth scheme. */
  RAG_DEFAULT_USER_ID: string;
}
