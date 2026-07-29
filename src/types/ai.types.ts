import type {
  AssistantModelMessage,
  ModelMessage,
  ToolChoice,
  ToolSet,
} from "ai";

export type MessageRole = "system" | "user" | "assistant";

export interface Message {
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: Date;
}

export interface Conversation {
  readonly id: string;
  readonly messages: readonly Message[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LLMRequest {
  /** Trusted server-side behavior and retrieved reference context. */
  readonly instructions?: string;
  /** AI SDK model messages, including the transient tool-turn messages. */
  readonly messages: readonly ModelMessage[];
  /** Declarative schemas only. Execution remains outside the provider. */
  readonly tools?: ToolSet;
  /** Controls whether the provider may, must, or must not call a tool. */
  readonly toolChoice?: ToolChoice<ToolSet>;
  readonly signal?: AbortSignal;
}

export interface LLMToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ModelInfo {
  readonly model: string;
  readonly contextWindow: number;
}

export interface LLMTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface ModelTokenUsage extends ModelInfo, LLMTokenUsage {
  /** Exact per-minute token allowance remaining, reported by the provider. */
  readonly remainingTokens: number | null;
}

export interface LLMResponse {
  readonly text: string;
  readonly toolCalls: readonly LLMToolCall[];
  /** Must be appended before corresponding tool-result messages. */
  readonly assistantMessage: AssistantModelMessage;
  /** Exact usage reported by the provider for this model call. */
  readonly usage: LLMTokenUsage;
  /** Exact per-minute token allowance remaining from provider HTTP headers. */
  readonly remainingTokens: number | null;
}

export interface LLMProvider {
  readonly modelInfo: ModelInfo;
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<string>;
}

export interface ChatOptions {
  readonly signal?: AbortSignal;
  readonly userType?: "agent" | "client";
  /** Trusted identity used to scope client data access. */
  readonly clientName?: string;
  /** Safety limit for consecutive model-to-tool rounds in one chat turn. */
  readonly maxToolRounds?: number;
}

export class InvalidConversationError extends Error {
  public constructor(message = "A valid conversation ID is required.") {
    super(message);
    this.name = "InvalidConversationError";
  }
}

export class EmptyPromptError extends Error {
  public constructor(message = "A non-empty prompt is required.") {
    super(message);
    this.name = "EmptyPromptError";
  }
}

export class ConversationNotFoundError extends Error {
  public constructor(id: string) {
    super(`Conversation "${id}" was not found.`);
    this.name = "ConversationNotFoundError";
  }
}

export class ProviderError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderError";
  }
}

export class TokenLimitError extends Error {
  public constructor(
    public readonly limit: "context" | "output",
    message = limit === "output"
      ? "The model reached its maximum output token limit."
      : "The request exceeded the model context token limit.",
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TokenLimitError";
  }
}

const TOKEN_LIMIT_PATTERN =
  /context_length_exceeded|maximum context length|max(?:imum)? (?:output )?tokens?|token limit|too many tokens/i;
const RATE_LIMIT_PATTERN =
  /rate[_ -]?limit|too many requests|requests per (?:minute|day)|tokens per minute/i;
const OUTPUT_PARSE_PATTERN =
  /output_parse_failed|tool_use_failed|tool call validation failed|parsing failed.*generated output|generated output.*could not be parsed/i;

/** Detects token-limit failures through provider and retry error wrappers. */
export const isTokenLimitError = (error: unknown): boolean => {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current instanceof TokenLimitError) return true;
    if (current === null || typeof current !== "object") {
      if (typeof current === "string" && TOKEN_LIMIT_PATTERN.test(current)) {
        return true;
      }
      continue;
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const record = current as Record<string, unknown>;
    for (const key of [
      "message",
      "code",
      "reason",
      "responseBody",
      "cause",
      "lastError",
      "errors",
      "data",
      "error",
    ]) {
      const value = record[key];
      if (typeof value === "string" && TOKEN_LIMIT_PATTERN.test(value)) {
        return true;
      }
      if (value !== undefined) pending.push(value);
    }
  }

  return false;
};

/** Detects provider throttling through AI SDK error wrappers. */
export const isRateLimitError = (error: unknown): boolean => {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") {
      if (typeof current === "string" && RATE_LIMIT_PATTERN.test(current)) {
        return true;
      }
      continue;
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const record = current as Record<string, unknown>;
    if (record.statusCode === 429 || record.status === 429) return true;

    for (const key of [
      "message",
      "code",
      "reason",
      "responseBody",
      "cause",
      "lastError",
      "errors",
      "data",
      "error",
    ]) {
      const value = record[key];
      if (typeof value === "string" && RATE_LIMIT_PATTERN.test(value)) {
        return true;
      }
      if (value !== undefined) pending.push(value);
    }
  }

  return false;
};

/** Detects malformed structured/tool output reported by the provider. */
export const isOutputParseError = (error: unknown): boolean => {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") {
      if (
        typeof current === "string" &&
        OUTPUT_PARSE_PATTERN.test(current)
      ) {
        return true;
      }
      continue;
    }
    if (visited.has(current)) continue;
    visited.add(current);

    const record = current as Record<string, unknown>;
    for (const key of [
      "message",
      "code",
      "responseBody",
      "cause",
      "lastError",
      "errors",
      "data",
      "error",
    ]) {
      const value = record[key];
      if (typeof value === "string" && OUTPUT_PARSE_PATTERN.test(value)) {
        return true;
      }
      if (value !== undefined) pending.push(value);
    }
  }

  return false;
};

const parseRetryAfter = (value: string, now: number): number | undefined => {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) return Math.max(0, retryAt - now);
  return undefined;
};

/** Extracts the HTTP Retry-After delay from nested provider errors. */
export const getRetryAfterMs = (
  error: unknown,
  now = Date.now(),
): number | undefined => {
  const pending: unknown[] = [error];
  const visited = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);

    const record = current as Record<string, unknown>;
    const headers = record.responseHeaders ?? record.headers;
    if (headers && typeof headers === "object") {
      const headerRecord = headers as Record<string, unknown>;
      const getter = headerRecord.get;
      const retryAfter =
        typeof getter === "function"
          ? getter.call(headers, "retry-after")
          : headerRecord["retry-after"] ?? headerRecord["Retry-After"];
      if (typeof retryAfter === "string") {
        const delay = parseRetryAfter(retryAfter, now);
        if (delay !== undefined) return delay;
      }
    }

    for (const key of [
      "cause",
      "lastError",
      "errors",
      "data",
      "error",
    ]) {
      const value = record[key];
      if (value !== undefined) pending.push(value);
    }
  }

  return undefined;
};
