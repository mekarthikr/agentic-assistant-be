import {
  type ChatOptions,
  EmptyPromptError,
  type LLMProvider,
  ProviderError,
} from "@app/types";
import {
  ApiDocumentationRag,
  INSURANCE_AGENT_SYSTEM_PROMPT,
} from "@app/knowledge";
import { ConversationService } from "./conversation.service";
import { ToolRegistry } from "./tool-registry.service";

const DEFAULT_MAX_TOOL_ROUNDS = 8;

export class AIOrchestrator {
  public constructor(
    private readonly conversationService: ConversationService,
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly apiDocumentation = new ApiDocumentationRag(),
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
      const retrievalQuery = conversation.messages
        .slice(-4)
        .map(({ content }) => content)
        .join("\n");
      const retrievedContext =
        this.apiDocumentation.retrieveContext(retrievalQuery);
      response = await this.generateWithTools(
        [
          {
            role: "system",
            content: this.buildSystemPrompt(retrievedContext),
          },
          ...conversation.messages.map(({ role, content }) => ({
            role,
            content,
          })),
        ],
        options,
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
  ): Promise<string> {
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let history = [...messages];

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const response = await this.provider.generate({
        messages: history,
        tools: this.toolRegistry.toToolSet(),
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
