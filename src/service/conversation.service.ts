import { randomUUID } from "node:crypto";

import {
  ConversationNotFoundError,
  InvalidConversationError,
  type Conversation,
  type Message,
  type MessageRole,
} from "@app/types";

/** Stores conversation history in memory and returns mutation-safe snapshots. */
export class ConversationService {
  private readonly conversations = new Map<string, Conversation>();

  /**
   * Creates a conversation unless it already exists.
   *
   * @param id - Optional conversation ID; a UUID is generated when omitted.
   * @returns An isolated snapshot of the conversation.
   */
  public createConversation(id: string = randomUUID()): Conversation {
    return this.toSnapshot(this.getOrCreateStoredConversation(id));
  }

  /**
   * Gets an existing conversation.
   *
   * @throws {ConversationNotFoundError} When the ID has not been created.
   */
  public getConversation(id: string): Conversation {
    const conversationId = this.validateConversationId(id);
    const conversation = this.conversations.get(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return this.toSnapshot(conversation);
  }

  /** Returns an existing conversation or creates it when first referenced. */
  public getOrCreateConversation(id: string): Conversation {
    return this.toSnapshot(this.getOrCreateStoredConversation(id));
  }

  /** Appends a user message and returns the updated conversation snapshot. */
  public addUserMessage(id: string, content: string): Conversation {
    return this.addMessage(id, "user", content);
  }

  /** Appends an assistant message and returns the updated conversation snapshot. */
  public addAssistantMessage(id: string, content: string): Conversation {
    return this.addMessage(id, "assistant", content);
  }

  /** Creates and stores an immutable message entry for the requested role. */
  private addMessage(
    id: string,
    role: MessageRole,
    content: string,
  ): Conversation {
    const conversation = this.getOrCreateStoredConversation(id);
    const message: Message = { role, content, createdAt: new Date() };
    const updatedConversation: Conversation = {
      ...conversation,
      messages: [...conversation.messages, message],
      updatedAt: message.createdAt,
    };
    this.conversations.set(conversation.id, updatedConversation);
    return this.toSnapshot(updatedConversation);
  }

  /** Returns the internal record for an ID, creating it when necessary. */
  private getOrCreateStoredConversation(id: string): Conversation {
    const conversationId = this.validateConversationId(id);
    const existingConversation = this.conversations.get(conversationId);
    if (existingConversation) return existingConversation;

    const now = new Date();
    const conversation: Conversation = {
      id: conversationId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversationId, conversation);
    return conversation;
  }

  /** Trims and validates a caller-supplied conversation identifier. */
  private validateConversationId(id: string): string {
    const conversationId = id.trim();
    if (!conversationId) throw new InvalidConversationError();
    return conversationId;
  }

  /** Copies dates and messages so callers cannot mutate stored history. */
  private toSnapshot(conversation: Conversation): Conversation {
    return {
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        createdAt: new Date(message.createdAt),
      })),
      createdAt: new Date(conversation.createdAt),
      updatedAt: new Date(conversation.updatedAt),
    };
  }
}
