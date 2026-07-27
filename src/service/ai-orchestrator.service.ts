import {
  type ChatOptions,
  EmptyPromptError,
  type LLMProvider,
  ProviderError,
} from "@app/types";
import { INSURANCE_ASSISTANT_SYSTEM_PROMPT } from "@app/prompts";
import { flowTracer } from "@app/observability";
import { ConversationService } from "./conversation.service";
import {
  EnterpriseRagService,
  type EnterpriseRetrieval,
} from "./enterprise-rag.service";
import { ToolRegistry } from "./tool-registry.service";

const DEFAULT_MAX_TOOL_ROUNDS = 8;

/** Coordinates conversation history, retrieval, model calls, and tool execution. */
export class AIOrchestrator {
  /**
   * Creates the application-level AI workflow.
   *
   * @param conversationService - In-memory conversation history store.
   * @param provider - Provider-agnostic language model adapter.
   * @param toolRegistry - Registry used to expose and execute application tools.
   * @param enterpriseRag - Optional enterprise documentation retriever.
   */
  public constructor(
    private readonly conversationService: ConversationService,
    private readonly provider: LLMProvider,
    private readonly toolRegistry: ToolRegistry,
    private readonly enterpriseRag?: EnterpriseRagService,
  ) {}

  /**
   * Processes a complete user turn and saves the successful assistant response.
   *
   * @param conversationId - Stable identifier used to retain chat history.
   * @param userMessage - Raw user message.
   * @param options - Cancellation and tool-loop controls.
   * @returns The final non-empty assistant response.
   */
  public async chat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): Promise<string> {
    const finishChat = flowTracer.start({
      stage: "conversation",
      action: "chat.started",
      summary: "AI orchestration started for a user turn.",
      context: { conversationId },
      details: { promptLength: userMessage.length },
    });
    const prompt = this.validatePrompt(userMessage);
    flowTracer.record({
      stage: "conversation",
      action: "prompt.validated",
      summary: "The user prompt passed validation.",
      details: { prompt, promptLength: prompt.length },
    });
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
    flowTracer.record({
      stage: "retrieval",
      level: "decision",
      action: "retrieval.decision",
      summary: retrieval
        ? `RAG selected ${retrieval.toolNames.length} enterprise tool(s).`
        : "RAG found no relevant enterprise operation.",
      details: {
        matched: Boolean(retrieval),
        selectedTools: retrieval?.toolNames ?? [],
        conversationMessageCount: conversation.messages.length,
      },
    });

    let response: string;
    try {
      response = await this.generateWithTools(
        conversation.messages.map(({ role, content }) => ({ role, content })),
        options,
        retrieval,
      );
    } catch (error) {
      finishChat({
        stage: "response",
        level: "error",
        action: "chat.failed",
        summary: "AI orchestration failed before producing a response.",
        details: { error },
      });
      this.throwIfAborted(options.signal);
      throw new ProviderError(
        "The AI provider could not generate a response.",
        error,
      );
    }

    this.validateResponse(response);
    this.conversationService.addAssistantMessage(conversationId, response);
    finishChat({
      stage: "response",
      level: "success",
      action: "chat.completed",
      summary: "The final assistant response was validated and stored.",
      details: { responseLength: response.length, response },
    });
    return response;
  }

  /**
   * Exposes the tool-aware chat workflow as an asynchronous response stream.
   *
   * Tool calls require complete model turns, so the current implementation
   * yields the final response as a single chunk.
   */
  public async *streamChat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): AsyncGenerator<string> {
    // Tool calls require a complete model turn before their result can be
    // supplied. Reuse the tool-aware path so streaming conversations preserve
    // the same semantics; transports still receive the final response chunk.
    yield await this.chat(conversationId, userMessage, options);
  }

  /**
   * Repeatedly asks the model to continue until it returns text without tools.
   *
   * @param messages - Conversation messages sent to the model.
   * @param options - Cancellation and maximum tool-round settings.
   * @param retrieval - Optional matching enterprise documentation and tools.
   * @returns The model's final text response.
   */
  private async generateWithTools(
    messages: Parameters<LLMProvider["generate"]>[0]["messages"],
    options: ChatOptions,
    retrieval?: EnterpriseRetrieval,
  ): Promise<string> {
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let history = [...messages];
    const system = [
      INSURANCE_ASSISTANT_SYSTEM_PROMPT,
      ...(retrieval
        ? [
            "Use the retrieved API documentation and available tools when enterprise data is required. Never invent endpoint behavior or enterprise records. Ask for a required parameter when it is missing.",
            "Retrieved enterprise API documentation:",
            retrieval.context,
          ]
        : []),
    ].join("\n\n");
    const tools = this.toolRegistry.toToolSet(retrieval?.toolNames);
    flowTracer.record({
      stage: "tool",
      level: "decision",
      action: "tools.exposed",
      summary: `${Object.keys(tools).length} tool schema(s) were exposed to the model.`,
      details: { toolNames: Object.keys(tools), maxToolRounds },
    });

    for (let round = 0; round <= maxToolRounds; round += 1) {
      const finishRound = flowTracer.start({
        stage: "model",
        action: "model.round.started",
        summary: `Model round ${round + 1} started.`,
        details: {
          round: round + 1,
          messageCount: history.length,
          toolCount: Object.keys(tools).length,
        },
      });
      const response = await this.provider.generate({
        system,
        messages: history,
        tools,
        signal: options.signal,
      });

      finishRound({
        level: "decision",
        action: "model.round.decided",
        summary:
          response.toolCalls.length === 0
            ? "The model returned a final text response."
            : `The model requested ${response.toolCalls.length} tool call(s).`,
        details: {
          round: round + 1,
          textLength: response.text.length,
          toolCalls: response.toolCalls.map(
            ({ toolCallId, toolName, input }) => ({
              toolCallId,
              toolName,
              input,
            }),
          ),
        },
      });

      if (response.toolCalls.length === 0) return response.text;
      if (round === maxToolRounds) {
        flowTracer.record({
          stage: "model",
          level: "error",
          action: "model.tool_limit.exceeded",
          summary: "The model exceeded the configured tool-call round limit.",
          details: { maxToolRounds },
        });
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

  /** Trims a prompt and rejects messages containing only whitespace. */
  private validatePrompt(userMessage: string): string {
    const prompt = userMessage.trim();
    if (!prompt) throw new EmptyPromptError();
    return prompt;
  }

  /** Rejects empty model responses before they are stored in conversation history. */
  private validateResponse(response: string): void {
    if (!response.trim()) {
      throw new ProviderError("The AI provider returned an empty response.");
    }
  }

  /** Re-throws an active cancellation using its original abort reason. */
  private throwIfAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
  }
}
