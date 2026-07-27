import { createGroq } from "@ai-sdk/groq";
import { generateText, streamText, type ModelMessage } from "ai";

import type { GroqConfiguration } from "@app/config/groq";
import type { LLMProvider, LLMRequest, Message } from "@app/types";

const toModelMessages = (messages: readonly Message[]): ModelMessage[] =>
  messages.map(({ role, content }) => ({ role, content }));

export class GroqProviderError extends Error {
  public constructor(operation: "generate" | "stream", cause: unknown) {
    super(`Groq could not ${operation} a response.`, { cause });
    this.name = "GroqProviderError";
  }
}

/** Groq adapter implemented against the provider-agnostic LLMProvider port. */
export class GroqProvider implements LLMProvider {
  private readonly client: ReturnType<typeof createGroq>;

  public constructor(
    private readonly configuration: GroqConfiguration,
    client?: ReturnType<typeof createGroq>,
  ) {
    this.client = client ?? createGroq({ apiKey: configuration.apiKey });
  }

  public async generate({ messages, signal }: LLMRequest): Promise<string> {
    try {
      const result = await generateText({
        model: this.client(this.configuration.model),
        messages: toModelMessages(messages),
        abortSignal: signal,
      });
      return result.text;
    } catch (error) {
      this.throwProviderError("generate", error, signal);
    }
  }

  public async *stream({
    messages,
    signal,
  }: LLMRequest): AsyncGenerator<string> {
    try {
      const result = streamText({
        model: this.client(this.configuration.model),
        messages: toModelMessages(messages),
        abortSignal: signal,
      });

      for await (const textDelta of result.textStream) {
        signal?.throwIfAborted();
        yield textDelta;
      }
    } catch (error) {
      this.throwProviderError("stream", error, signal);
    }
  }

  private throwProviderError(
    operation: "generate" | "stream",
    error: unknown,
    signal?: AbortSignal,
  ): never {
    signal?.throwIfAborted();
    if (error instanceof GroqProviderError) throw error;
    throw new GroqProviderError(operation, error);
  }
}
