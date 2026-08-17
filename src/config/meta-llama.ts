import { env } from "./env";

export interface MetaLlamaConfiguration {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindow: number;
}

/** Validated Meta Llama configuration used by the provider adapter. */
export const metaLlamaConfiguration: MetaLlamaConfiguration = {
  apiKey: env.LLAMA_API_KEY,
  baseUrl: env.LLAMA_API_BASE_URL,
  model: env.LLAMA_MODEL,
  contextWindow: env.LLAMA_MODEL_CONTEXT_WINDOW,
};
