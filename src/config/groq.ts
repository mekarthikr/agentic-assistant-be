import { env } from "./env.js";

export interface GroqConfiguration {
  readonly apiKey: string;
  readonly model: string;
}

/** Validated Groq configuration used by the provider adapter. */
export const groqConfiguration: GroqConfiguration = {
  apiKey: env.GROQ_API_KEY,
  model: env.GROQ_MODEL,
};
