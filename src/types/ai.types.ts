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
  readonly messages: readonly Message[];
  readonly signal?: AbortSignal;
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<string>;
  stream(request: LLMRequest): AsyncIterable<string>;
}

export interface ChatOptions {
  readonly signal?: AbortSignal;
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
