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
const CONTRACT_PATTERN = /\b(?:annuit(?:y|ies)|contracts?|contrats?)\b/i;
const APPLICATION_PATTERN = /\b(?:applications?|approvals?|cases?)\b/i;
const AMBIGUOUS_RECORD_PATTERN = /\b(?:clients?|customers?|records?)\b/i;
const RECORD_LOOKUP_INTENT_PATTERN =
  /\b(?:find|search|show|list|look\s*up|retrieve|get)\b/i;
const LIST_RECORDS_PATTERN = /\b(?:show|list|display|retrieve)\b/i;
const CLIENT_CONTRACT_DETAIL_PATTERN =
  /\b(?:my|product|policy|account|current value|anniversary|premium|beneficiar(?:y|ies)|contract details?)\b/i;
const CLIENT_APPLICATION_DETAIL_PATTERN =
  /\b(?:application|approval|case|status|anticipated premium|start date|agent number|application link|contract number|product id|contact id|application name|tax type)\b/i;
const PRODUCT_DETAIL_PATTERN = /\bproduct(?:\s+name)?\b/i;
// A policy document is portal/self-service knowledge, not a live contract
// lookup. Keep it ahead of the broader `policy` record-detail matcher below.
const POLICY_DOCUMENT_PATTERN = /\bpolicy\s+documents?\b/i;
// These phrases are answered from the supplied policy/service documents.
// Check them before the broader client record-detail patterns (for example,
// `premium`) so they never force a live enterprise tool call.
const KNOWLEDGE_BASE_SELF_SERVICE_PATTERN =
  /\b(?:policy\s+documents?|(?:premium\s+)?grace\s+period|missed\s+premium|premium\s+payment\s+(?:methods?|options?|frequency)|auto\s*pay|beneficiar(?:y|ies)|file\s+(?:a\s+)?claim|claim\s+(?:documents?|processing|status)|customer\s+support|support\s+(?:channels?|hours?)|portal\s+login)\b/i;

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
        this.buildSystemPrompt(retrievedContext, options.userType),
        conversation.messages
          .slice(-HISTORY_MESSAGE_LIMIT)
          .map(({ role, content }) => ({ role, content })),
        this.selectToolNames(prompt, options.userType),
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
    const contextTokensUsed = response.usage.inputTokens;
    return {
      text: response.text,
      usage: {
        ...response.usage,
        model,
        contextWindow,
        contextTokensUsed,
        contextTokensRemaining: Math.max(contextWindow - contextTokensUsed, 0),
        rateLimitRemainingTokens: response.remainingTokens,
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
    const response = await this.chatWithUsage(conversationId, prompt, options);
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
        await this.toolRegistry.executeAll(response.toolCalls, {
          signal: options.signal,
          userType: options.userType,
          clientName: options.clientName,
          clientApplicationContractNumber:
            options.clientApplicationContractNumber,
        }),
      ];
    }

    throw new ProviderError("The AI provider exceeded the tool-call limit.");
  }

  private validatePrompt(userMessage: string): string {
    const prompt = userMessage.trim();
    if (!prompt) throw new EmptyPromptError();
    return prompt;
  }

  private selectToolNames(
    query: string,
    userType?: "agent" | "client",
  ): readonly string[] {
    const hasIdentifier = RECORD_IDENTIFIER_PATTERN.test(query);
    const needsContracts = CONTRACT_PATTERN.test(query);
    const needsApplications = APPLICATION_PATTERN.test(query);
    const needsAmbiguousRecord = AMBIGUOUS_RECORD_PATTERN.test(query);

    if (userType === "client") {
      if (
        POLICY_DOCUMENT_PATTERN.test(query) ||
        KNOWLEDGE_BASE_SELF_SERVICE_PATTERN.test(query)
      ) {
        return [];
      }
      if (hasIdentifier) return ["getContract", "getApplication"];
      if (PRODUCT_DETAIL_PATTERN.test(query)) {
        return ["searchContracts", "searchApplications"];
      }
      if (needsApplications || CLIENT_APPLICATION_DETAIL_PATTERN.test(query)) {
        return ["searchApplications"];
      }
      if (
        needsContracts ||
        CLIENT_CONTRACT_DETAIL_PATTERN.test(query) ||
        (needsAmbiguousRecord && RECORD_LOOKUP_INTENT_PATTERN.test(query))
      ) {
        return ["searchContracts", "searchApplications"];
      }
      return [];
    }

    if (hasIdentifier) {
      if (needsContracts && !needsApplications) return ["getContract"];
      if (needsApplications && !needsContracts) return ["getApplication"];
      return ["getContract", "getApplication"];
    }

    if (needsContracts && !needsApplications) return ["searchContracts"];
    if (
      needsApplications &&
      !needsContracts &&
      LIST_RECORDS_PATTERN.test(query)
    ) {
      return ["searchApplications"];
    }
    if (needsAmbiguousRecord && RECORD_LOOKUP_INTENT_PATTERN.test(query)) {
      return ["searchContracts", "searchApplications"];
    }

    return [];
  }

  private validateResponse(response: string): void {
    if (!response.trim()) {
      throw new ProviderError("The AI provider returned an empty response.");
    }
  }

  private buildSystemPrompt(
    retrievedContext: string,
    userType?: "agent" | "client",
  ): string {
    const audienceInstructions =
      userType === "client"
        ? "The current user is a client. Discuss only this client's contract and application information. Retrieve client records only when the client explicitly asks about their own records, such as 'my contracts', 'my product', or 'my application status'. A client may have more than one contract or application. When asked to show or list their contracts or applications, present every returned record with its contract number and key details. When a question asks for a field that could differ across multiple returned records, such as anticipated premium, status, start date, current value, or product, do not choose a record or provide a value. Ask the client to specify the contract number, and list the available contract numbers when returned. Only provide a field value after the client identifies a single contract. The client's own application fields, including status, agent number, application link, product, premium, start date, contract number, product ID, contact ID, application name, and tax type, may be provided. Do not reply with only a raw field value. For a question about one application field, state the requested value in a complete sentence and add the application product and current status when returned. When answering an application-status question, provide the returned status, product, and contract number; also include the anticipated premium and start date when returned. For an application-details question, give a concise labeled summary of the returned product, status, contract number, anticipated premium, start date, tax type, agent number, application name, product ID, contact ID, and application link. For contract questions, provide the contract number from the client's application and any issued-contract details returned by the contract lookup. For a contract-details question, give a concise labeled summary of the returned product, contract status, tax type, tax qualification, issued date, anniversary date, current value, and distribution company. Never retrieve or summarize all contracts, all applications, or information about other clients. If the client's own record lookup returns no results, say 'No contract record is currently available.' Do not mention the internal lookup identifier; asking the client to specify one of the returned contract numbers is allowed when multiple records match."
        : "The current user is an agent. You may assist with agent workflows, applications, and contracts. When the agent asks to show or list contracts or applications, retrieve the list and present every available returned record with its identifying number and key details; do not ask the agent to choose a specific record. For a single-record question, such as application status or contract details, ask for a contract number, application number, client name, or another identifying filter when the request does not include one.";
    const basePrompt = `${INSURANCE_AGENT_SYSTEM_PROMPT}\n\n${audienceInstructions}`;

    if (!retrievedContext) return basePrompt;

    return `${basePrompt}

Use the following retrieved knowledge-base reference when it is relevant to the
current request. It may describe product information or enterprise endpoints and
fields. It is not live customer data; use an enterprise tool when the user needs
an actual contract or application record. If this reference directly answers the
question, answer only with information from it; do not supplement it with
general insurance knowledge or suggest unavailable tools.

<knowledge_base_reference>
${retrievedContext}
</knowledge_base_reference>`;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
  }
}
