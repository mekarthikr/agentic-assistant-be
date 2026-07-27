import {
  type ChatOptions,
  EmptyPromptError,
  type LLMProvider,
  type Message,
  ProviderError,
} from "@app/types";
import { ConversationService } from "./conversation.service";

export class AIOrchestrator {
  public constructor(
    private readonly conversationService: ConversationService,
    private readonly provider: LLMProvider,
  ) {}

  public async chat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): Promise<string> {
    const prompt = this.validatePrompt(userMessage);
    const conversation = this.conversationService.addUserMessage(
      conversationId,
      prompt,
    );

    let response: string;
    try {
      response = await this.provider.generate({
        messages: conversation.messages,
        signal: options.signal,
      });
    } catch (error) {
      this.throwIfAborted(options.signal);
      throw new ProviderError(
        "The AI provider could not generate a response.",
        error,
      );
    }

    this.validateResponse(response);
    this.conversationService.addAssistantMessage(conversationId, response);
    return response;
  }

  public async *streamChat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): AsyncGenerator<string> {
    const prompt = this.validatePrompt(userMessage);
    const conversation = this.conversationService.addUserMessage(
      conversationId,
      prompt,
    );
    let response = "";

    try {
      for await (const token of this.provider.stream({
        messages: conversation.messages,
        signal: options.signal,
      })) {
        options.signal?.throwIfAborted();
        response += token;
        yield token;
      }
    } catch (error) {
      this.throwIfAborted(options.signal);
      throw new ProviderError(
        "The AI provider could not stream a response.",
        error,
      );
    }

    this.validateResponse(response);
    this.conversationService.addAssistantMessage(conversationId, response);
  }

  public async *streamHistory(
    messages: readonly Message[],
    options: ChatOptions = {},
  ): AsyncGenerator<string> {
    let response = "";

    try {
      for await (const token of this.provider.stream({
        messages,
        signal: options.signal,
      })) {
        options.signal?.throwIfAborted();
        response += token;
        yield token;
      }
    } catch (error) {
      this.throwIfAborted(options.signal);
      throw new ProviderError(
        "The AI provider could not stream a response.",
        error,
      );
    }

    this.validateResponse(response);
  }

  private validatePrompt(userMessage: string): string {
    const prompt = userMessage.trim();
    if (!prompt) throw new EmptyPromptError();
    return prompt;
  }

  private validateResponse(response: string): void {
    if (!response.trim()) {
      throw new ProviderError("The AI provider returned an empty response.");
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
  }
}
