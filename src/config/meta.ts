import { env } from "./env";

export interface MetaConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly baseURL?: string;
}

/** Validated configuration for Meta's official Llama developer API. */
export const metaConfiguration: MetaConfiguration = {
  apiKey: env.LLAMA_API_KEY,
  model: env.LLAMA_MODEL,
  contextWindow: env.LLAMA_MODEL_CONTEXT_WINDOW,
  ...(env.LLAMA_API_BASE_URL ? { baseURL: env.LLAMA_API_BASE_URL } : {}),
};
