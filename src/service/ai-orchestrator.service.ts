import {
  type ChatOptions,
  type ChatCompletion,
  type ChatSource,
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
  NO_DOCUMENTED_SOLUTION_RESPONSE,
  type RetrievedDocumentationSource,
} from "@app/knowledge";
import { ConversationService } from "./conversation.service";
import { ToolRegistry } from "./tool-registry.service";
import { logError } from "@app/utils/error-logger";
import { normalizeAssistantResponse } from "@app/utils/assistant-response";
import type { ApiResponse, Contract } from "@app/types";

const DEFAULT_MAX_TOOL_ROUNDS = 3;
const HISTORY_MESSAGE_LIMIT = 4;
const RETRIEVAL_MESSAGE_LIMIT = 2;
const RECORD_IDENTIFIER_PATTERN = /\b\d{5,}\b/;
const RECORD_IDENTIFIER_ONLY_PATTERN = /^\d{5,}$/;
const RECORD_IDENTIFIER_CAPTURE_PATTERN = /\b\d{5,}\b/g;
const CONTRACT_ID_REQUEST_MESSAGE = "Could you please provide the contract ID?";
const SAME_CONTRACT_PATTERN = /\bsame\s+contract\b/i;
const CONTRACT_PATTERN = /\b(?:annuit(?:y|ies)|contracts?|contrats?)\b/i;
const APPLICATION_PATTERN = /\b(?:applications?|approvals?|cases?)\b/i;
const AMBIGUOUS_RECORD_PATTERN = /\b(?:clients?|customers?|records?)\b/i;
const RECORD_LOOKUP_INTENT_PATTERN =
  /\b(?:find|search|show|list|look\s*up|retrieve|get)\b/i;
const LIST_RECORDS_PATTERN = /\b(?:show|list|display|retrieve)\b/i;
const CLIENT_CONTRACT_DETAIL_PATTERN =
  /\b(?:product|policy|account|current value|anniversary|premium|beneficiar(?:y|ies)|contract details?)\b/i;
const CLIENT_APPLICATION_DETAIL_PATTERN =
  /\b(?:application|approval|case|status|anticipated premium|start date|agent number|application link|contract number|product id|contact id|application name|tax type)\b/i;
const PRODUCT_DETAIL_PATTERN = /\bproduct(?:\s+name)?\b/i;
const CLIENT_LIST_REQUEST_PATTERN = /\b(?:list|all|every)\b/i;
// A policy document is portal/self-service knowledge, not a live contract
// lookup. Keep it ahead of the broader `policy` record-detail matcher below.
const POLICY_DOCUMENT_PATTERN = /\bpolicy\s+documents?\b/i;
// These phrases are answered from the supplied policy/service documents.
// Check them before the broader client record-detail patterns (for example,
// `premium`) so they never force a live enterprise tool call.
const KNOWLEDGE_BASE_SELF_SERVICE_PATTERN =
  /\b(?:policy\s+documents?|(?:premium\s+)?grace\s+period|missed\s+premium|premium\s+payment\s+(?:methods?|options?|frequency)|auto\s*pay|beneficiar(?:y|ies)|file\s+(?:a\s+)?claim|claim\s+(?:documents?|processing|status)|customer\s+support|support\s+(?:channels?|hours?)|portal\s+login)\b/i;
const DOCUMENTED_PROCEDURE_PATTERN =
  /\b(?:over\s+(?:the\s+)?(?:phone|chat)|spousal\s+consent|joint\s+owners?|beneficiary\s+changes?|electronic\s+fund\s+transfers?|EFTs?|annuitization|index\s+lock|lifetime\s+income\s+benefit|LIBR|maturity\s+date|outstanding\s+checks?|partial\s+withdrawals?|pre-authorized\s+credits?|PACs?|required\s+minimum\s+distributions?|RMDs?|rush\s+reviews?|surrenders?|systematic\s+withdrawals?|transfer\s+of\s+values?|TOVs?|72T|72Q|pending\s+suitability|transfer\s+(?:the\s+)?call|which\s+(?:team|queue|department))\b/i;

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
  ): Promise<{
    text: string;
    usage: ModelTokenUsage;
    sources: readonly ChatSource[];
  }> {
    const prompt = this.validatePrompt(userMessage);
    const conversation = this.conversationService.addUserMessage(
      conversationId,
      prompt,
    );

    const contextualPortalNavigation = this.resolveContextualPortalNavigation(
      conversation,
      prompt,
    );
    if (contextualPortalNavigation?.url) {
      const text = `${contextualPortalNavigation.message}\n\n[${contextualPortalNavigation.linkText}](${contextualPortalNavigation.url})`;
      this.conversationService.addAssistantMessage(conversationId, text);
      return this.directResponse(text);
    }

    const pendingPortalNavigation = this.resolvePendingPortalNavigation(
      conversation,
      prompt,
    );
    if (pendingPortalNavigation?.url) {
      const text = `${pendingPortalNavigation.message}\n\n[${pendingPortalNavigation.linkText}](${pendingPortalNavigation.url})`;
      this.conversationService.addAssistantMessage(conversationId, text);
      return this.directResponse(text);
    }

    const portalNavigation =
      this.apiDocumentation.resolvePortalNavigation(prompt);
    if (portalNavigation) {
      const text = portalNavigation.missingParameter
        ? CONTRACT_ID_REQUEST_MESSAGE
        : `${portalNavigation.message}\n\n[${portalNavigation.linkText}](${portalNavigation.url})`;
      this.conversationService.addAssistantMessage(conversationId, text);
      return this.directResponse(text);
    }

    const knowledgeAnswer =
      this.apiDocumentation.resolveKnowledgeAnswer(prompt);
    if (knowledgeAnswer) {
      const text = knowledgeAnswer.answer;
      this.conversationService.addAssistantMessage(conversationId, text);
      return this.directResponse(text);
    }

    const retrievalQuery = conversation.messages
      .slice(-RETRIEVAL_MESSAGE_LIMIT)
      .map(({ content }) => content)
      .join("\n");
    const retrievedSections =
      this.apiDocumentation.retrieveKnowledge(retrievalQuery);
    const retrievedContext =
      this.apiDocumentation.formatContext(retrievedSections);
    const retrievedSources = retrievedSections.map(({ source }) => source);

    let response: LLMResponse & { readonly toolResults: readonly unknown[] };
    try {
      response = await this.generateWithTools(
        this.buildSystemPrompt(
          retrievedContext,
          options.userType,
          options.clientName,
        ),
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

    const assistantText = normalizeAssistantResponse(
      this.normalizeDisplayCasing(
        this.formatClientProductSelection(
          prompt,
          response.text,
          options.userType,
          response.toolResults,
        ),
      ),
    );
    this.validateResponse(assistantText);
    this.conversationService.addAssistantMessage(conversationId, assistantText);
    const { model, contextWindow } = this.provider.modelInfo;
    const contextTokensUsed = response.usage.inputTokens;
    return {
      text: assistantText,
      usage: {
        ...response.usage,
        model,
        contextWindow,
        contextTokensUsed,
        contextTokensRemaining: Math.max(contextWindow - contextTokensUsed, 0),
        rateLimitRemainingTokens: response.remainingTokens,
      },
      sources:
        assistantText === NO_DOCUMENTED_SOLUTION_RESPONSE
          ? []
          : this.toChatSources(retrievedSources),
    };
  }

  public async *streamChat(
    conversationId: string,
    userMessage: string,
    options: ChatOptions = {},
  ): AsyncGenerator<string, ChatCompletion> {
    const prompt = this.validatePrompt(userMessage);
    // Tool calls require a complete model turn before their result can be
    // supplied. Reuse the tool-aware path so streaming conversations preserve
    // the same semantics; transports still receive the final response chunk.
    const response = await this.chatWithUsage(conversationId, prompt, options);
    yield response.text;
    return { tokenUsage: response.usage, sources: response.sources };
  }

  private toChatSources(
    sources: readonly RetrievedDocumentationSource[],
  ): readonly ChatSource[] {
    const uniqueSources = new Map<string, ChatSource>();

    for (const source of sources) {
      const id = `${source.filename}${
        source.page === undefined ? "" : `#page=${source.page}`
      }`;
      uniqueSources.set(id, { id, ...source });
    }

    return [...uniqueSources.values()];
  }

  private async generateWithTools(
    instructions: string,
    messages: Parameters<LLMProvider["generate"]>[0]["messages"],
    toolNames: readonly string[],
    options: ChatOptions,
  ): Promise<LLMResponse & { toolResults: readonly unknown[] }> {
    const maxToolRounds = options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;
    let history = [...messages];
    const toolResults: unknown[] = [];

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

      if (response.toolCalls.length === 0) return { ...response, toolResults };
      if (round === maxToolRounds) {
        throw new ProviderError(
          "The AI provider exceeded the tool-call limit.",
        );
      }

      const executedTools = await this.toolRegistry.executeAllWithResults(
        response.toolCalls,
        {
          signal: options.signal,
          userType: options.userType,
          clientName: options.clientName,
        },
      );
      toolResults.push(...executedTools.values);
      history = [...history, response.assistantMessage, executedTools.message];
    }

    throw new ProviderError("The AI provider exceeded the tool-call limit.");
  }

  private validatePrompt(userMessage: string): string {
    const prompt = userMessage.trim();
    if (!prompt) throw new EmptyPromptError();
    return prompt;
  }

  private resolvePendingPortalNavigation(
    conversation: ReturnType<ConversationService["addUserMessage"]>,
    prompt: string,
  ) {
    if (!RECORD_IDENTIFIER_ONLY_PATTERN.test(prompt)) return undefined;

    const previousAssistant = conversation.messages.at(-2);
    const previousUser = conversation.messages.at(-3);
    if (
      previousAssistant?.role !== "assistant" ||
      previousAssistant.content.trim() !== CONTRACT_ID_REQUEST_MESSAGE ||
      previousUser?.role !== "user"
    ) {
      return undefined;
    }

    return this.apiDocumentation.resolvePortalNavigation(
      `${previousUser.content} ${prompt}`,
    );
  }

  private resolveContextualPortalNavigation(
    conversation: ReturnType<ConversationService["addUserMessage"]>,
    prompt: string,
  ) {
    if (
      !SAME_CONTRACT_PATTERN.test(prompt) ||
      RECORD_IDENTIFIER_PATTERN.test(prompt)
    ) {
      return undefined;
    }

    const contractId = this.latestContractIdFrom(conversation);
    if (!contractId) return undefined;

    return this.apiDocumentation.resolvePortalNavigation(
      `${prompt} ${contractId}`,
    );
  }

  private latestContractIdFrom(
    conversation: ReturnType<ConversationService["addUserMessage"]>,
  ): string | undefined {
    for (let index = conversation.messages.length - 2; index >= 0; index -= 1) {
      const matches = [
        ...conversation.messages[index].content.matchAll(
          RECORD_IDENTIFIER_CAPTURE_PATTERN,
        ),
      ];
      const latestMatch = matches.at(-1);
      if (latestMatch) return latestMatch[0];
    }

    return undefined;
  }

  private directResponse(text: string): {
    text: string;
    usage: ModelTokenUsage;
    sources: readonly ChatSource[];
  } {
    const { model, contextWindow } = this.provider.modelInfo;
    return {
      text,
      usage: {
        model,
        contextWindow,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokensUsed: 0,
        contextTokensRemaining: contextWindow,
        rateLimitRemainingTokens: null,
      },
      sources: [],
    };
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
      if (CLIENT_LIST_REQUEST_PATTERN.test(query)) {
        return [];
      }
      if (hasIdentifier) {
        return needsApplications ? ["getApplication"] : ["getContract"];
      }
      if (
        needsApplications ||
        (!needsContracts && CLIENT_APPLICATION_DETAIL_PATTERN.test(query))
      ) {
        return ["searchApplications"];
      }
      if (needsContracts || CLIENT_CONTRACT_DETAIL_PATTERN.test(query)) {
        return ["searchContracts"];
      }
      if (PRODUCT_DETAIL_PATTERN.test(query)) {
        return ["searchContracts"];
      }
      if (needsAmbiguousRecord && RECORD_LOOKUP_INTENT_PATTERN.test(query)) {
        return ["searchContracts", "searchApplications"];
      }
      return [];
    }

    if (hasIdentifier) {
      if (needsContracts && !needsApplications) return ["getContract"];
      if (needsApplications && !needsContracts) return ["getApplication"];
      return ["getContract", "getApplication"];
    }

    if (DOCUMENTED_PROCEDURE_PATTERN.test(query)) return [];

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

  private normalizeDisplayCasing(response: string): string {
    // Tax qualifications are display values, not identifiers. Normalize these
    // known API values after generation so the presentation stays consistent
    // even when the model echoes the API's all-caps text.
    return response
      .replace(
        /(tax qualification(?:\s+is|\s*[:=-])\s*)ROTH IRA\b/gi,
        "$1Roth Ira",
      )
      .replace(
        /(tax qualification(?:\s+is|\s*[:=-])\s*)NON-QUAL\b/gi,
        "$1Non-Qual",
      )
      .replace(/(tax qualification(?:\s+is|\s*[:=-])\s*)IRA\b/gi, "$1Ira");
  }

  private formatClientProductSelection(
    query: string,
    response: string,
    userType: ChatOptions["userType"],
    toolResults: readonly unknown[],
  ): string {
    if (userType !== "client" || !PRODUCT_DETAIL_PATTERN.test(query)) {
      return response;
    }

    const contracts = toolResults.flatMap((result) => {
      if (!this.isContractListResponse(result)) return [];
      return result.data;
    });
    if (contracts.length < 2) return response;

    const count = this.contractCountLabel(contracts.length);
    const products = contracts.map(({ productName }) =>
      productName
        .toLowerCase()
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
    );

    return `You have ${count} contracts. Here are the product names for each contract:\n\n${products.map((product) => `- ${product}`).join("\n")}\n\nPlease select a contract number or product name to view more details.`;
  }

  private isContractListResponse(
    value: unknown,
  ): value is ApiResponse<Contract[]> {
    if (!value || typeof value !== "object") return false;
    const data = (value as { data?: unknown }).data;
    return (
      Array.isArray(data) &&
      data.every(
        (item) =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { productName?: unknown }).productName === "string" &&
          typeof (item as { contractNumber?: unknown }).contractNumber ===
            "string",
      )
    );
  }

  private contractCountLabel(count: number): string {
    const labels = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
      "eleven",
      "twelve",
      "thirteen",
      "fourteen",
      "fifteen",
      "sixteen",
      "seventeen",
      "eighteen",
      "nineteen",
      "twenty",
    ];
    return labels[count] ?? String(count);
  }

  private buildSystemPrompt(
    retrievedContext: string,
    userType?: "agent" | "client",
    clientName?: string,
  ): string {
    const audienceInstructions =
      userType === "client"
        ? `The current user is a client${clientName ? ` signed in as ${clientName}` : ""}. If they ask for their name, state their signed-in name and do not retrieve contracts or applications. Discuss only this client's contract and application information. Retrieve client records only when the client explicitly asks about their own records, such as 'my contracts', 'my product', or 'my application status'. The client's own application fields, including status, agent number, application link, product, premium, start date, contract number, product ID, contact ID, application name, and tax type, may be provided. When any application-related question returns exactly one application, always begin the response with exactly: 'You have only one application.' Then answer the client's question using that application's returned details. This rule includes questions about product ID, contact ID, status, agent number, contract number, application name, product, premium, start date, tax type, and application link. Never answer any of these fields with only its raw value when exactly one application was returned. For a question about one application field, state the requested value in a complete sentence and add the application product and current status when returned. When answering an application-status or agent-number question, use the returned application record and state the requested value, product, status, and contract number. Do not claim that application data is unavailable when the application tool returned a record. When a contract lookup returns more than one contract, never select one or give the details for just one. State how many contracts were found, list each contract number with its product and status, and ask the client to select a contract number or product before providing contract-specific details. For a question asking for contract numbers, list every returned contract number with its product and status, then ask which contract they want to discuss. For contract details without a selected contract, apply the same selection prompt rather than giving detailed information. Once the client selects a contract number or product, provide a concise labeled contract-details summary containing product, contract status, tax type, tax qualification, issued date, anniversary date, current value, and distribution company. Do not omit these returned fields. For an application-details question, give a concise labeled summary of the returned product, status, contract number, anticipated premium, start date, tax type, agent number, application name, product ID, contact ID, and application link. Never retrieve or summarize contracts, applications, or information about other clients. If a contract lookup returns no results, say 'No contract record is currently available.' If an application lookup returns no results, say 'No application record is currently available.' Do not mention the lookup identifier or application number, and do not ask the client for extra identifiers other than selecting one of multiple returned contracts. Present every human-readable name, label, and value in natural title or sentence case, even if the API returns it in all capitals. This includes tax types and tax qualifications: display NON-QUAL as 'Non-Qual', ROTH IRA as 'Roth Ira', and IRA as 'Ira'. Preserve exact identifiers, contract and application numbers, product IDs, URLs, monetary amounts, and dates.`
        : "The current user is an agent. You may assist with agent workflows, applications, and contracts. When the agent asks to show or list contracts or applications, retrieve the list and present every available returned record with its identifying number and key details; do not ask the agent to choose a specific record. For a single-record question, such as application status or contract details, ask for a contract number, application number, client name, or another identifying filter when the request does not include one. Present every human-readable name, label, and value in natural title or sentence case, even if the API returns it in all capitals. This includes tax types and tax qualifications: display NON-QUAL as 'Non-Qual', ROTH IRA as 'Roth Ira', and IRA as 'Ira'. Preserve exact identifiers, contract and application numbers, product IDs, URLs, monetary amounts, and dates.";
    const basePrompt = `${INSURANCE_AGENT_SYSTEM_PROMPT}\n\n${audienceInstructions}`;

    if (!retrievedContext) return basePrompt;

    return `${basePrompt}

Use the retrieved knowledge-base reference below only when relevant. It is not
live customer data. If it answers the request, answer only with facts from it.
Do not add outside knowledge, unsupported links, or unavailable tools.

<knowledge_base_reference>
${retrievedContext}
</knowledge_base_reference>`;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
  }
}
