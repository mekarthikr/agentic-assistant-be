import LlamaAPIClient from "llama-api-client";
import {
  asSchema,
  type AssistantModelMessage,
  type ModelMessage,
  type ToolChoice,
  type ToolSet,
} from "ai";

import type { MetaConfiguration } from "@app/config/meta";
import {
  TokenLimitError,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from "@app/types";
import { logError } from "@app/utils/error-logger";

const REMAINING_TOKENS_HEADER = "x-ratelimit-remaining-tokens";

const normalizeMetricName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

const getMetric = (
  metrics: LlamaAPIClient.CreateChatCompletionResponse.Metric[] | undefined,
  names: readonly string[],
): number | undefined => {
  const acceptedNames = new Set(names.map(normalizeMetricName));
  return metrics?.find(({ metric }) =>
    acceptedNames.has(normalizeMetricName(metric)),
  )?.value;
};

const getTokenUsage = (
  metrics: LlamaAPIClient.CreateChatCompletionResponse.Metric[] | undefined,
) => {
  const inputTokens = getMetric(metrics, [
    "prompt_tokens",
    "input_tokens",
    "num_prompt_tokens",
  ]);
  const outputTokens = getMetric(metrics, [
    "completion_tokens",
    "output_tokens",
    "num_completion_tokens",
  ]);
  const totalTokens =
    getMetric(metrics, ["total_tokens", "num_total_tokens"]) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  if (
    inputTokens === undefined ||
    outputTokens === undefined ||
    totalTokens === undefined
  ) {
    throw new Error("Meta Llama response did not include token usage metrics.");
  }

  return { inputTokens, outputTokens, totalTokens };
};

const getRemainingTokens = (headers: Headers): number | null => {
  const value = headers.get(REMAINING_TOKENS_HEADER);
  if (value === null || !/^\d+$/.test(value)) return null;

  const remainingTokens = Number(value);
  return Number.isSafeInteger(remainingTokens) ? remainingTokens : null;
};

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (
      content &&
      typeof content === "object" &&
      "text" in content &&
      typeof content.text === "string"
    ) {
      return content.text;
    }
    return "";
  }

  return content
    .flatMap((part) =>
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
};

const toolOutputText = (output: unknown): string => {
  if (!output || typeof output !== "object") return JSON.stringify(output);
  if (
    "value" in output &&
    (typeof output.value === "string" || output.value !== undefined)
  ) {
    return typeof output.value === "string"
      ? output.value
      : JSON.stringify(output.value);
  }
  return JSON.stringify(output);
};

const toMetaMessages = (
  instructions: string | undefined,
  messages: readonly ModelMessage[],
): LlamaAPIClient.Message[] => {
  const converted: LlamaAPIClient.Message[] = instructions
    ? [{ role: "system", content: instructions }]
    : [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "user") {
      converted.push({
        role: message.role,
        content: contentText(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts = Array.isArray(message.content) ? message.content : [];
      const toolCalls = parts.flatMap((part) =>
        part.type === "tool-call"
          ? [
              {
                id: part.toolCallId,
                function: {
                  name: part.toolName,
                  arguments: JSON.stringify(part.input),
                },
              },
            ]
          : [],
      );
      converted.push({
        role: "assistant",
        content: contentText(message.content),
        ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
      });
      continue;
    }

    for (const result of message.content) {
      if (result.type !== "tool-result") continue;
      converted.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: toolOutputText(result.output),
      });
    }
  }

  return converted;
};

const toMetaTools = async (
  tools: ToolSet | undefined,
): Promise<LlamaAPIClient.Chat.CompletionCreateParams.Tool[] | undefined> => {
  if (!tools) return undefined;

  const converted = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => ({
      type: "function" as const,
      function: {
        name,
        ...(typeof tool.description === "string"
          ? { description: tool.description }
          : {}),
        parameters: (await asSchema(tool.inputSchema).jsonSchema) as Record<
          string,
          unknown
        >,
      },
    })),
  );
  return converted.length === 0 ? undefined : converted;
};

const toMetaToolChoice = (
  toolChoice: ToolChoice<ToolSet> | undefined,
): LlamaAPIClient.Chat.CompletionCreateParams["tool_choice"] => {
  if (toolChoice === undefined || typeof toolChoice === "string") {
    return toolChoice;
  }
  return {
    type: "function",
    function: { name: toolChoice.toolName },
  };
};

const parseToolInput = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error("Parsing failed for generated output tool arguments.", {
      cause: error,
    });
  }
};

class MetaProviderError extends Error {
  public constructor(operation: "generate" | "stream", cause: unknown) {
    super(`Meta Llama could not ${operation} a response.`, { cause });
    this.name = "MetaProviderError";
  }
}

/** Adapter for Meta's official Llama developer API. */
export class MetaProvider implements LLMProvider {
  private readonly client: LlamaAPIClient;
  public readonly modelInfo;

  public constructor(
    private readonly configuration: MetaConfiguration,
    client?: LlamaAPIClient,
  ) {
    this.client =
      client ??
      new LlamaAPIClient({
        apiKey: configuration.apiKey,
        ...(configuration.baseURL ? { baseURL: configuration.baseURL } : {}),
        maxRetries: 1,
      });
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
      const { data, response } = await this.client.chat.completions
        .create(
          {
            model: this.configuration.model,
            messages: toMetaMessages(instructions, messages),
            tools: await toMetaTools(tools),
            tool_choice: toMetaToolChoice(toolChoice),
            temperature: 0,
          },
          { signal, maxRetries: 1 },
        )
        .withResponse();
      const message = data.completion_message;
      if (message.stop_reason === "length") {
        throw new TokenLimitError("output");
      }

      const text = contentText(message.content);
      const toolCalls = (message.tool_calls ?? []).map((call) => ({
        toolCallId: call.id,
        toolName: call.function.name,
        input: parseToolInput(call.function.arguments),
      }));
      const assistantMessage: AssistantModelMessage = {
        role: "assistant",
        content: toolCalls.length
          ? [
              ...(text ? [{ type: "text" as const, text }] : []),
              ...toolCalls.map((call) => ({
                type: "tool-call" as const,
                ...call,
              })),
            ]
          : text,
      };

      return {
        text,
        toolCalls,
        assistantMessage,
        usage: getTokenUsage(data.metrics),
        remainingTokens: getRemainingTokens(response.headers),
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
      const stream = await this.client.chat.completions.create(
        {
          model: this.configuration.model,
          messages: toMetaMessages(instructions, messages),
          tools: await toMetaTools(tools),
          tool_choice: toMetaToolChoice(toolChoice),
          temperature: 0,
          stream: true,
        },
        { signal, maxRetries: 1 },
      );

      for await (const chunk of stream) {
        signal?.throwIfAborted();
        if (chunk.event.stop_reason === "length") {
          throw new TokenLimitError("output");
        }
        if (chunk.event.delta.type === "text") {
          yield chunk.event.delta.text;
        }
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
    if (error instanceof MetaProviderError) throw error;
    logError("Meta Llama provider request failed", error, {
      operation,
      model: this.configuration.model,
    });
    throw new MetaProviderError(operation, error);
  }
}
