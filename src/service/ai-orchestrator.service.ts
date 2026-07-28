import {
  type ChatOptions,
  EmptyPromptError,
  type LLMProvider,
  type LLMResponse,
  type ModelInfo,
  type ModelTokenUsage,
  ProviderError,
} from "@app/types";
import {
  ApiDocumentationRag,
  INSURANCE_AGENT_SYSTEM_PROMPT,
} from "@app/knowledge";
import { ConversationService } from "./conversation.service";
import { ToolRegistry } from "./tool-registry.service";
import { logError } from "@app/utils/error-logger";

const DEFAULT_MAX_TOOL_ROUNDS = 3;
const HISTORY_MESSAGE_LIMIT = 6;
const RETRIEVAL_MESSAGE_LIMIT = 2;
const RECORD_IDENTIFIER_PATTERN = /\b\d{5,}\b/;
const CONTRACT_PATTERN =
  /\b(?:annuit(?:y|ies)|contracts?|contrats?|polic(?:y|ies))\b/i;
const APPLICATION_PATTERN = /\b(?:applications?|approvals?|cases?)\b/i;
const AMBIGUOUS_RECORD_PATTERN = /\b(?:clients?|customers?|records?)\b/i;

export class AIOrchestrator {
  public constructor(
    private readonly conversationService: ConversationService,
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly apiDocumentation = new ApiDocumentationRag(),
  ) {}

  public getModelInfo(): ModelInfo {
    return this.provider.modelInfo;
  }

  public async chat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): Promise<string> {
    return (await this.chatWithUsage(conversationId, userMessage, options))
      .text;
  }

  private async chatWithUsage(
    conversationId: string,
    userMessage: string,
    options: ChatOptions,
  ): Promise<{ text: string; usage: ModelTokenUsage }> {
    const prompt = this.validatePrompt(userMessage);
    const conversation = this.conversationService.addUserMessage(
      conversationId,
      prompt,
    );

    let response: LLMResponse;
    try {
      const retrievalQuery = conversation.messages
        .slice(-RETRIEVAL_MESSAGE_LIMIT)
        .map(({ content }) => content)
        .join("\n");
      const retrievedContext =
        this.apiDocumentation.retrieveContext(retrievalQuery);
      response = await this.generateWithTools(
        this.buildSystemPrompt(retrievedContext),
        conversation.messages
          .slice(-HISTORY_MESSAGE_LIMIT)
          .map(({ role, content }) => ({ role, content })),
        this.selectToolNames(prompt),
        options,
      );
    } catch (error) {
      this.throwIfAborted(options.signal);
      logError("AI orchestration failed", error, {
        conversationId,
        historyMessageCount: conversation.messages.length,
      });
      throw new ProviderError(
        "The AI provider could not generate a response.",
        error,
      );
    }

    this.validateResponse(response.text);
    this.conversationService.addAssistantMessage(conversationId, response.text);
    const { model, contextWindow } = this.provider.modelInfo;
    return {
      text: response.text,
      usage: {
        ...response.usage,
        model,
        contextWindow,
        remainingTokens: response.remainingTokens,
      },
    };
  }

  public async *streamChat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): AsyncGenerator<string, ModelTokenUsage> {
    const prompt = this.validatePrompt(userMessage);
    // Tool calls require a complete model turn before their result can be
    // supplied. Reuse the tool-aware path so streaming conversations preserve
    // the same semantics; transports still receive the final response chunk.
    const response = await this.chatWithUsage(
      conversationId,
      prompt,
      options,
    );
    yield response.text;
    return response.usage;
  }

  private async generateWithTools(
    instructions: string,
    messages: Parameters<LLMProvider["generate"]>[0]["messages"],
    toolNames: readonly string[],
    options: ChatOptions,
  ): Promise<LLMResponse> {
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let history = [...messages];

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const toolChoice =
        round > 0 || toolNames.length === 0
          ? "auto"
          : toolNames.length === 1
            ? ({ type: "tool", toolName: toolNames[0] } as const)
            : "required";
      const response = await this.provider.generate({
        instructions,
        messages: history,
        tools: this.toolRegistry.toToolSet(toolNames),
        toolChoice,
        signal: options.signal,
      });

      if (response.toolCalls.length === 0) return response;
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

  private selectToolNames(query: string): readonly string[] {
    const hasIdentifier = RECORD_IDENTIFIER_PATTERN.test(query);
    const needsContracts = CONTRACT_PATTERN.test(query);
    const needsApplications = APPLICATION_PATTERN.test(query);
    const needsAmbiguousRecord = AMBIGUOUS_RECORD_PATTERN.test(query);

    if (hasIdentifier) {
      if (needsContracts && !needsApplications) return ["getContract"];
      if (needsApplications && !needsContracts) return ["getApplication"];
      return ["getContract", "getApplication"];
    }

    if (needsContracts && !needsApplications) return ["searchContracts"];
    if (needsApplications && !needsContracts) return ["searchApplications"];
    if (needsContracts || needsApplications || needsAmbiguousRecord) {
      return ["searchContracts", "searchApplications"];
    }

    return [];
  }

  private validateResponse(response: string): void {
    if (!response.trim()) {
      throw new ProviderError("The AI provider returned an empty response.");
    }
  }

  private buildSystemPrompt(retrievedContext: string): string {
    if (!retrievedContext) return INSURANCE_AGENT_SYSTEM_PROMPT;

    return `${INSURANCE_AGENT_SYSTEM_PROMPT}

Use the following retrieved enterprise API reference when it is relevant to the
current request. It describes available endpoints and fields, not live customer
data. Use an enterprise tool when the user needs an actual record.

<enterprise_api_reference>
${retrievedContext}
</enterprise_api_reference>`;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
  }
}
