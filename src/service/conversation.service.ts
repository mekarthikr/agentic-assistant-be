import { randomUUID } from "node:crypto";

import {
  ConversationNotFoundError,
  InvalidConversationError,
  type Conversation,
  type Message,
  type MessageRole,
} from "@app/types";

export class ConversationService {
  private readonly conversations = new Map<string, Conversation>();

  public createConversation(id: string = randomUUID()): Conversation {
    const conversationId = this.validateConversationId(id);
    const existingConversation = this.conversations.get(conversationId);
    if (existingConversation) return this.toSnapshot(existingConversation);

    const now = new Date();
    const conversation: Conversation = {
      id: conversationId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(conversationId, conversation);
    return this.toSnapshot(conversation);
  }

  public getConversation(id: string): Conversation {
    const conversationId = this.validateConversationId(id);
    const conversation = this.conversations.get(conversationId);
    if (!conversation) throw new ConversationNotFoundError(conversationId);
    return this.toSnapshot(conversation);
  }

  public getOrCreateConversation(id: string): Conversation {
    const conversationId = this.validateConversationId(id);
    return this.conversations.has(conversationId)
      ? this.getConversation(conversationId)
      : this.createConversation(conversationId);
  }

  public addUserMessage(id: string, content: string): Conversation {
    return this.addMessage(id, "user", content);
  }

  public addAssistantMessage(id: string, content: string): Conversation {
    return this.addMessage(id, "assistant", content);
  }

  /** Removes a user turn that did not receive an assistant response. */
  public discardPendingUserMessage(id: string, content: string): boolean {
    const conversationId = this.validateConversationId(id);
    const conversation = this.conversations.get(conversationId);
    const pendingMessage = conversation?.messages.at(-1);

    if (
      !conversation ||
      pendingMessage?.role !== "user" ||
      pendingMessage.content !== content
    ) {
      return false;
    }

    const messages = conversation.messages.slice(0, -1);
    this.conversations.set(conversationId, {
      ...conversation,
      messages,
      updatedAt: messages.at(-1)?.createdAt ?? conversation.createdAt,
    });
    return true;
  }

  public deleteConversation(id: string): boolean {
    return this.conversations.delete(this.validateConversationId(id));
  }

  public clearConversation(id: string): Conversation {
    const conversation = this.getConversation(id);
    const clearedConversation: Conversation = {
      ...conversation,
      messages: [],
      updatedAt: new Date(),
    };
    this.conversations.set(conversation.id, clearedConversation);
    return this.toSnapshot(clearedConversation);
  }

  public listConversations(): Conversation[] {
    return [...this.conversations.values()].map((conversation) =>
      this.toSnapshot(conversation),
    );
  }

  private addMessage(
    id: string,
    role: MessageRole,
    content: string,
  ): Conversation {
    const conversation = this.getOrCreateConversation(id);
    const message: Message = { role, content, createdAt: new Date() };
    const updatedConversation: Conversation = {
      ...conversation,
      messages: [...conversation.messages, message],
      updatedAt: message.createdAt,
    };
    this.conversations.set(conversation.id, updatedConversation);
    return this.toSnapshot(updatedConversation);
  }

  private validateConversationId(id: string): string {
    const conversationId = id.trim();
    if (!conversationId) throw new InvalidConversationError();
    return conversationId;
  }

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
