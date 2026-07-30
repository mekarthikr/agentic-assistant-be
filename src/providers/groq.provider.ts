import { createGroq, type GroqLanguageModelChatOptions } from "@ai-sdk/groq";
import { generateText, streamText, type AssistantModelMessage } from "ai";

import type { GroqConfiguration } from "@app/config/groq";
import {
  TokenLimitError,
  isOutputParseError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from "@app/types";
import { logError } from "@app/utils/error-logger";

const REMAINING_TOKENS_HEADER = "x-ratelimit-remaining-tokens";

const requireTokenCount = (
  value: number | undefined,
  field: string,
): number => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Groq response usage did not include a valid ${field}.`);
  }
  return value;
};

const getRemainingTokens = (
  headers: Record<string, string> | undefined,
): number | null => {
  const value = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === REMAINING_TOKENS_HEADER,
  )?.[1];
  if (value === undefined || !/^\d+$/.test(value)) return null;

  const remainingTokens = Number(value);
  return Number.isSafeInteger(remainingTokens) ? remainingTokens : null;
};

class GroqProviderError extends Error {
  public constructor(operation: "generate" | "stream", cause: unknown) {
    super(`Groq could not ${operation} a response.`, { cause });
    this.name = "GroqProviderError";
  }
}

/** Groq adapter implemented against the provider-agnostic LLMProvider port. */
export class GroqProvider implements LLMProvider {
  private readonly client: ReturnType<typeof createGroq>;
  public readonly modelInfo;

  public constructor(
    private readonly configuration: GroqConfiguration,
    client?: ReturnType<typeof createGroq>,
  ) {
    this.client = client ?? createGroq({ apiKey: configuration.apiKey });
    this.modelInfo = {
      model: configuration.model,
      contextWindow: configuration.contextWindow,
    };
  }

  public async generate({
    instructions,
    messages,
    tools,
    toolChoice,
    signal,
  }: LLMRequest): Promise<LLMResponse> {
    try {
      const generate = (retryingParseFailure = false) =>
        generateText({
          model: this.client(this.configuration.model),
          instructions: retryingParseFailure
            ? `${instructions ?? ""}

Return a valid structured tool call. Do not describe or simulate the tool call in text.
Use only arguments declared by the selected tool's schema. Never pass null for a
required argument or add filter fields to a single-record lookup. Use an
identifier from the conversation when the schema requires one.`
            : instructions,
          messages: [...messages],
          tools,
          toolChoice,
          maxRetries: 1,
          temperature: 0,
          providerOptions: {
            groq: {
              parallelToolCalls: false,
            } satisfies GroqLanguageModelChatOptions,
          },
          abortSignal: signal,
        });

      let result: Awaited<ReturnType<typeof generate>>;
      try {
        result = await generate();
      } catch (error) {
        if (!tools || !isOutputParseError(error)) throw error;
        logError(
          "Groq tool output parsing failed; retrying with strict tool instructions",
          error,
          {
            operation: "generate",
            model: this.configuration.model,
            toolChoice,
          },
          "warn",
        );
        result = await generate(true);
      }
      if (result.finishReason === "length") {
        throw new TokenLimitError("output");
      }
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
      return {
        text: result.text,
        toolCalls,
        assistantMessage,
        usage: {
          inputTokens: requireTokenCount(
            result.usage.inputTokens,
            "input token count",
          ),
          outputTokens: requireTokenCount(
            result.usage.outputTokens,
            "output token count",
          ),
          totalTokens: requireTokenCount(
            result.usage.totalTokens,
            "total token count",
          ),
        },
        remainingTokens: getRemainingTokens(result.response.headers),
      };
    } catch (error) {
      this.throwProviderError("generate", error, signal);
    }
  }

  public async *stream({
    instructions,
    messages,
    tools,
    toolChoice,
    signal,
  }: LLMRequest): AsyncGenerator<string> {
    try {
      const result = streamText({
        model: this.client(this.configuration.model),
        instructions,
        messages: [...messages],
        tools,
        toolChoice,
        maxRetries: 1,
        temperature: 0,
        providerOptions: {
          groq: {
            parallelToolCalls: false,
          } satisfies GroqLanguageModelChatOptions,
        },
        abortSignal: signal,
      });

      for await (const textDelta of result.textStream) {
        signal?.throwIfAborted();
        yield textDelta;
      }

      if ((await result.finishReason) === "length") {
        throw new TokenLimitError("output");
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
    logError("Groq provider request failed", error, {
      operation,
      model: this.configuration.model,
    });
    throw new GroqProviderError(operation, error);
  }
}
