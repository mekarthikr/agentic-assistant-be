import { createGroq } from "@ai-sdk/groq";
import { generateText, type AssistantModelMessage } from "ai";

import type { GroqConfiguration } from "@app/config/groq";
import type { LLMProvider, LLMRequest, LLMResponse } from "@app/types";

/** Wraps failures raised while requesting a response from Groq. */
export class GroqProviderError extends Error {
  public constructor(cause: unknown) {
    super("Groq could not generate a response.", { cause });
    this.name = "GroqProviderError";
  }
}

/** Groq adapter implemented against the provider-agnostic LLMProvider port. */
export class GroqProvider implements LLMProvider {
  private readonly client: ReturnType<typeof createGroq>;

  /**
   * Creates a Groq adapter.
   *
   * @param configuration - API credentials and model name.
   * @param client - Optional client override used by tests or custom setups.
   */
  public constructor(
    private readonly configuration: GroqConfiguration,
    client?: ReturnType<typeof createGroq>,
  ) {
    this.client = client ?? createGroq({ apiKey: configuration.apiKey });
  }

  /**
   * Generates one complete model turn, including any requested tool calls.
   *
   * @param request - Conversation, system instructions, tools, and cancellation signal.
   * @returns Normalized text, tool calls, and assistant history message.
   */
  public async generate({
    system,
    messages,
    tools,
    signal,
  }: LLMRequest): Promise<LLMResponse> {
    try {
      const result = await generateText({
        model: this.client(this.configuration.model),
        system,
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
      this.throwProviderError(error, signal);
    }
  }

  /** Preserves cancellation errors and normalizes other provider failures. */
  private throwProviderError(error: unknown, signal?: AbortSignal): never {
    signal?.throwIfAborted();
    if (error instanceof GroqProviderError) throw error;
    throw new GroqProviderError(error);
  }
}
