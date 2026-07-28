import { createGroq } from "@ai-sdk/groq";
import { generateText, streamText, type AssistantModelMessage } from "ai";

import type { GroqConfiguration } from "@app/config/groq";
import type { LLMProvider, LLMRequest, LLMResponse } from "@app/types";

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

  public async generate({
    instructions,
    messages,
    tools,
    signal,
  }: LLMRequest): Promise<LLMResponse> {
    try {
      const result = await generateText({
        model: this.client(this.configuration.model),
        instructions,
        messages: [...messages],
        tools,
        abortSignal: signal,
      });
      const toolCalls = result.toolCalls.map(
        ({ toolCallId, toolName, input }) => ({
          toolCallId,
          toolName,
          input,
        }),
      );
      const assistantMessage: AssistantModelMessage = {
        role: "assistant",
        content: toolCalls.length
          ? [
              ...(result.text
                ? [{ type: "text" as const, text: result.text }]
                : []),
              ...toolCalls.map((call) => ({
                type: "tool-call" as const,
                ...call,
              })),
            ]
          : result.text,
      };
      return { text: result.text, toolCalls, assistantMessage };
    } catch (error) {
      this.throwProviderError("generate", error, signal);
    }
  }

  public async *stream({
    instructions,
    messages,
    tools,
    signal,
  }: LLMRequest): AsyncGenerator<string> {
    try {
      const result = streamText({
        model: this.client(this.configuration.model),
        instructions,
        messages: [...messages],
        tools,
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
