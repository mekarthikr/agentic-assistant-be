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
  /** Trusted server-side behavior and retrieved reference context. */
  readonly instructions?: string;
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
  stream(request: LLMRequest): AsyncIterable<string>;
}

export interface ChatOptions {
  readonly signal?: AbortSignal;
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
