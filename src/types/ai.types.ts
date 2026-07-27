import type { AssistantModelMessage, ModelMessage, ToolSet } from "ai";

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
  /** Retrieved instructions and knowledge supplied separately from chat history. */
  readonly system?: string;
  /** AI SDK model messages, including the transient tool-turn messages. */
  readonly messages: readonly ModelMessage[];
  /** Declarative schemas only. Execution remains outside the provider. */
  readonly tools?: ToolSet;
  readonly signal?: AbortSignal;
}

export interface LLMToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface LLMResponse {
  readonly text: string;
  readonly toolCalls: readonly LLMToolCall[];
  /** Must be appended before corresponding tool-result messages. */
  readonly assistantMessage: AssistantModelMessage;
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
}

export interface ChatOptions {
  readonly signal?: AbortSignal;
  /** Safety limit for consecutive model-to-tool rounds in one chat turn. */
  readonly maxToolRounds?: number;
}

/** Indicates that a caller supplied an empty or whitespace conversation ID. */
export class InvalidConversationError extends Error {
  public constructor(message = "A valid conversation ID is required.") {
    super(message);
    this.name = "InvalidConversationError";
  }
}

/** Indicates that a caller supplied an empty or whitespace chat prompt. */
export class EmptyPromptError extends Error {
  public constructor(message = "A non-empty prompt is required.") {
    super(message);
    this.name = "EmptyPromptError";
  }
}

/** Indicates that a requested in-memory conversation does not exist. */
export class ConversationNotFoundError extends Error {
  public constructor(id: string) {
    super(`Conversation "${id}" was not found.`);
    this.name = "ConversationNotFoundError";
  }
}

/** Hides provider-specific errors behind an application-level failure. */
export class ProviderError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProviderError";
  }
}
