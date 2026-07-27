import { createGroq } from "@ai-sdk/groq";
import { generateText, type AssistantModelMessage } from "ai";

import type { GroqConfiguration } from "@app/config/groq";
import type { LLMProvider, LLMRequest, LLMResponse } from "@app/types";
import { flowTracer } from "@app/observability";

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
    const finishGeneration = flowTracer.start({
      stage: "model",
      action: "groq.request.started",
      summary: `Sending a generation request to ${this.configuration.model}.`,
      details: {
        model: this.configuration.model,
        messageCount: messages.length,
        toolNames: Object.keys(tools ?? {}),
        systemPromptLength: system?.length ?? 0,
      },
    });
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
      finishGeneration({
        level: "success",
        action: "groq.request.completed",
        summary: "Groq returned a model response.",
        details: {
          model: this.configuration.model,
          textLength: result.text.length,
          toolCallCount: toolCalls.length,
        },
      });
      return { text: result.text, toolCalls, assistantMessage };
    } catch (error) {
      finishGeneration({
        level: "error",
        action: "groq.request.failed",
        summary: "Groq failed to return a model response.",
        details: { model: this.configuration.model, error },
      });
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
