import { env } from "./env";

export interface GroqConfiguration {
  readonly apiKey: string;
  readonly model: string;
  readonly contextWindow: number;
}

/** Validated Groq configuration used by the provider adapter. */
export const groqConfiguration: GroqConfiguration = {
  apiKey: env.GROQ_API_KEY,
  model: env.GROQ_MODEL,
  contextWindow: env.GROQ_MODEL_CONTEXT_WINDOW,
};
