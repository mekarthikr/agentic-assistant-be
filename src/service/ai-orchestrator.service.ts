import {
  type ChatOptions,
  EmptyPromptError,
  type LLMProvider,
  ProviderError,
} from "../types/index.js";
import { buildInsuranceAgentSystemPrompt } from "../prompts/insurance-agent.prompt.js";
import { ConversationService } from "./conversation.service.js";
import {
  EnterpriseRagService,
  type EnterpriseRetrieval,
} from "./enterprise-rag.service.js";
import { ToolRegistry } from "./tool-registry.service.js";

const DEFAULT_MAX_TOOL_ROUNDS = 8;

export class AIOrchestrator {
  public constructor(
    private readonly conversationService: ConversationService,
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly enterpriseRag?: EnterpriseRagService,
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
    const retrieval = this.enterpriseRag?.retrieve(
      conversation.messages
        .filter(({ role }) => role === "user")
        .slice(-4)
        .map(({ content }) => content)
        .join("\n"),
    );

    let response: string;
    try {
      response = await this.generateWithTools(
        conversation.messages.map(({ role, content }) => ({ role, content })),
        options,
        retrieval,
      );
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
    // Tool calls require a complete model turn before their result can be
    // supplied. Reuse the tool-aware path so streaming conversations preserve
    // the same semantics; transports still receive the final response chunk.
    yield await this.chat(conversationId, prompt, options);
  }

  private async generateWithTools(
    messages: Parameters<LLMProvider["generate"]>[0]["messages"],
    options: ChatOptions,
    retrieval?: EnterpriseRetrieval,
  ): Promise<string> {
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let history = [...messages];

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const response = await this.provider.generate({
        system: buildInsuranceAgentSystemPrompt(retrieval),
        messages: history,
        tools: this.toolRegistry.toToolSet(retrieval?.toolNames),
        signal: options.signal,
      });

      if (response.toolCalls.length === 0) return response.text;
      if (round === maxToolRounds) {
        throw new ProviderError(
          "The AI provider exceeded the tool-call limit.",
        );
      }

      history = [
        ...history,
        response.assistantMessage,
        await this.toolRegistry.executeAll(response.toolCalls, options.signal),
      ];
    }

    throw new ProviderError("The AI provider exceeded the tool-call limit.");
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
