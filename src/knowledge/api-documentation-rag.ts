import generatedIndex from "./enterprise-api-rag.json" with { type: "json" };

const DEFAULT_RESULT_LIMIT = 2;
const MAX_CONTEXT_CHARACTERS = 3_500;
const MINIMUM_RELEVANCE_SCORE = 1;
const TOKEN_PATTERN = /[a-z0-9]+/g;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "for",
  "from",
  "get",
  "i",
  "in",
  "is",
  "me",
  "my",
  "of",
  "on",
  "please",
  "show",
  "the",
  "to",
  "what",
  "with",
]);
const CONTRACT_LIST_REQUEST_PATTERN =
  /\b(?:list|all|every)\b[^.?!\n]*\b(?:contracts?|polic(?:y|ies))\b|\b(?:contracts?|polic(?:y|ies))\b[^.?!\n]*\b(?:list|all|every)\b|\b(?:show|display|retrieve|get)\b[^.?!\n]*\bcontracts?\b/i;
const CONTRACT_DETAILS_NAVIGATION_PATTERN =
  /\b(?:contract|policy)\s+details?\b|\bdetails?\s+(?:page|screen|link|navigation)\b|\b(?:open|navigate|go|take)\b[^.?!\n]*\b(?:contract|policy)\b/i;
const POLICY_DOCUMENT_REQUEST_PATTERN =
  /\bpolicy\s+documents?\b|\bdownload\b[^.?!\n]*\bpolicy\b|\bpolicy\b[^.?!\n]*\bdownload\b/i;
const CUSTOMER_SUPPORT_REQUEST_PATTERN =
  /\bcustomer\s+support\b|\bsupport\s+(?:channels?|hours?|topics?)\b|\bportal\s+login(?:\s+issues?)?\b|\blogin\s+issues?\b/i;
const PORTAL_NAVIGATION_ACTION_PATTERN =
  /\b(?:navigate|navigation|open)\b|\bgo\s+to\b|\btake\s+me\s+to\b/i;
const PORTAL_NAVIGATION_LINK_PATTERN = /\b(?:url|link|page|screen)\b/i;

const QUERY_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  approval: ["application", "status"],
  approvals: ["application", "status"],
  case: ["application"],
  cases: ["application"],
  customer: ["client"],
  customers: ["client"],
  policy: ["contract"],
  policies: ["contract"],
  policyholder: ["client", "contract"],
  policyholders: ["client", "contract"],
};

export interface RetrievedDocumentationSection {
  readonly heading: string;
  readonly content: string;
  readonly score: number;
  readonly source: RetrievedDocumentationSource;
}

export interface RetrievedDocumentationSource {
  readonly filename: string;
  readonly title: string;
  readonly mediaType: string;
  readonly page?: number;
}

export interface PortalNavigationKnowledgeResult {
  readonly linkText: string;
  readonly message: string;
  readonly url?: string;
  readonly missingParameter?: string;
}

export interface KnowledgeBaseAnswer {
  readonly answer: string;
}

interface DocumentationSection {
  readonly heading: string;
  readonly content: string;
  readonly headingTokens: readonly string[];
  readonly contentTokens: readonly string[];
  readonly source: RetrievedDocumentationSource;
}

interface GeneratedDocumentationIndex {
  readonly version: number;
  readonly sources: readonly string[];
  readonly sourceHash: string;
  readonly sections: readonly DocumentationSection[];
}

const normalizeToken = (token: string): string => {
  if (token.endsWith("ies") && token.length > 4)
    return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
  return token;
};

const tokenize = (value: string): string[] =>
  (value.toLowerCase().match(TOKEN_PATTERN) ?? [])
    .map(normalizeToken)
    .filter((token) => !STOP_WORDS.has(token));

const expandQueryTokens = (query: string): string[] => {
  const tokens = tokenize(query);
  const expanded = tokens.flatMap((token) => [
    token,
    ...(QUERY_EXPANSIONS[token] ?? []),
  ]);
  return [...new Set(expanded.map(normalizeToken))];
};

const sectionHeading = (content: string): string => {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1];
  return heading?.trim() || "Enterprise API overview";
};

const splitDocumentation = (markdown: string): DocumentationSection[] =>
  markdown
    .split(/(?=^#{2,3}\s+)/m)
    .map((content) => content.trim())
    .filter(Boolean)
    .map((content) => {
      const heading = sectionHeading(content);
      return {
        heading,
        content,
        headingTokens: tokenize(heading),
        contentTokens: tokenize(content),
        source: {
          filename: "inline-document.md",
          title: heading,
          mediaType: "text/markdown",
        },
      };
    });

const fieldValue = (content: string, field: string): string | undefined => {
  const match = content.match(
    new RegExp(
      `^${field}:[ \\t]*\\r?\\n([\\s\\S]*?)(?:\\r?\\n(?=(?:[A-Z][^\\r\\n]*:|#{1,3}\\s+))|(?![\\s\\S]))`,
      "m",
    ),
  );
  return match?.[1]?.trim();
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keywordValuesFrom = (content: string): string[] =>
  (fieldValue(content, "Keywords") ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);

const isPortalNavigationSection = (content: string): boolean =>
  content.startsWith("## ") &&
  fieldValue(content, "Keywords") !== undefined &&
  fieldValue(content, "Message") !== undefined &&
  fieldValue(content, "URL") !== undefined;

const queryContainsKeyword = (
  query: string,
  keywords: readonly string[],
): boolean =>
  keywords.some((keyword) =>
    new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i").test(query),
  );

const contractIdFrom = (query: string): string | undefined =>
  query.match(/\b\d+\b/)?.[0];

const answerBodyFrom = (content: string): string =>
  content
    .replace(/^#{1,3}\s+.+\r?\n/, "")
    .replace(/\r?\n---\s*$/, "")
    .trim();

const isCustomerSupportSection = (
  section: Pick<DocumentationSection, "heading" | "content">,
): boolean =>
  /\bcustomer-support\.md\)/i.test(section.heading) ||
  /^# Customer Support\b/i.test(section.content) ||
  /^## (?:Support Channels|Business Hours|Common Support Topics)\b/i.test(
    section.content,
  );

const customerSupportAnswerFrom = (
  sections: readonly Pick<DocumentationSection, "heading" | "content">[],
): string | undefined => {
  const customerSupportSections = sections.filter(isCustomerSupportSection);
  if (customerSupportSections.length === 0) return undefined;

  const listItemsFrom = (content: string): string[] =>
    content
      .split(/\r?\n/)
      .map((line) => line.match(/^-\s+(.+)$/)?.[1]?.trim())
      .filter((item): item is string => Boolean(item));

  const supportChannels = customerSupportSections.find(({ content }) =>
    /^## Support Channels\b/i.test(content),
  );
  const businessHours = customerSupportSections.find(({ content }) =>
    /^## Business Hours\b/i.test(content),
  );
  const commonTopics = customerSupportSections.find(({ content }) =>
    /^## Common Support Topics\b/i.test(content),
  );

  const answerParts = [
    supportChannels
      ? `Customer support is available through ${listItemsFrom(supportChannels.content).join(", ")}.`
      : undefined,
    businessHours
      ? `Business hours: ${answerBodyFrom(businessHours.content)
          .replace(/\s+/g, " ")
          .replace(/\u2013/g, "-")}.`
      : undefined,
    commonTopics
      ? `Common support topics: ${listItemsFrom(commonTopics.content).join(", ")}.`
      : undefined,
  ].filter((part): part is string => Boolean(part));

  return (
    answerParts.length > 0
      ? answerParts.join("\n\n")
      : answerBodyFrom(customerSupportSections[0].content)
  ).trim();
};

const isContractListRequest = (query: string): boolean =>
  CONTRACT_LIST_REQUEST_PATTERN.test(query) &&
  !CONTRACT_DETAILS_NAVIGATION_PATTERN.test(query);

const isPortalNavigationRequest = (
  query: string,
  navigationSection: Pick<DocumentationSection, "content">,
): boolean => {
  if (PORTAL_NAVIGATION_ACTION_PATTERN.test(query)) return true;
  return (
    PORTAL_NAVIGATION_LINK_PATTERN.test(query) &&
    queryContainsKeyword(query, keywordValuesFrom(navigationSection.content))
  );
};

const bestPortalNavigationSection = (
  query: string,
  sections: readonly RetrievedDocumentationSection[],
): RetrievedDocumentationSection | undefined => {
  const navigationSections = sections
    .filter(({ content }) => isPortalNavigationSection(content))
    .filter((section) => isPortalNavigationRequest(query, section));
  const keywordMatchedSection = navigationSections.find(({ content }) =>
    queryContainsKeyword(query, keywordValuesFrom(content)),
  );

  return keywordMatchedSection ?? navigationSections[0];
};

const loadGeneratedIndex = (): readonly DocumentationSection[] => {
  const index = generatedIndex as GeneratedDocumentationIndex;

  if (
    index.version !== 3 ||
    !Array.isArray(index.sources) ||
    !Array.isArray(index.sections)
  ) {
    throw new Error("The generated knowledge-base RAG index is invalid.");
  }

  return index.sections;
};

const countOccurrences = (
  tokens: readonly string[],
  queryToken: string,
): number =>
  tokens.reduce((total, token) => total + Number(token === queryToken), 0);

const relevanceScore = (
  section: DocumentationSection,
  queryTokens: readonly string[],
): number =>
  queryTokens.reduce(
    (score, token) =>
      score +
      countOccurrences(section.headingTokens, token) * 5 +
      Math.min(countOccurrences(section.contentTokens, token), 4),
    0,
  );

/**
 * Small, local RAG index over enterprise API and product reference documents.
 *
 * The document is loaded and chunked once. Each chat turn retrieves only the
 * highest-scoring sections, keeping prompt context focused and deterministic.
 */
export class ApiDocumentationRag {
  private readonly sections: readonly DocumentationSection[];

  public constructor(markdown?: string) {
    this.sections =
      markdown === undefined
        ? loadGeneratedIndex()
        : splitDocumentation(markdown);
  }

  public retrieve(
    query: string,
    limit = DEFAULT_RESULT_LIMIT,
  ): RetrievedDocumentationSection[] {
    const queryTokens = expandQueryTokens(query);
    if (queryTokens.length === 0 || limit <= 0) return [];

    return this.sections
      .map((section) => ({
        heading: section.heading,
        content: section.content,
        score: relevanceScore(section, queryTokens),
        source: section.source,
      }))
      .filter(({ score }) => score >= MINIMUM_RELEVANCE_SCORE)
      .sort(
        (left, right) =>
          right.score - left.score || left.heading.localeCompare(right.heading),
      )
      .slice(0, limit);
  }

  public retrieveContext(query: string, limit = DEFAULT_RESULT_LIMIT): string {
    const portalNavigation = this.resolvePortalNavigation(query);
    if (portalNavigation) {
      if (portalNavigation.missingParameter) {
        return `Portal navigation result\nmissingParameter: ${portalNavigation.missingParameter}`;
      }
      return `Portal navigation result\nMessage:\n${portalNavigation.message}\n\nLink Text:\n${portalNavigation.linkText}\n\nURL:\n${portalNavigation.url}`;
    }

    return this.formatContext(this.retrieveKnowledge(query, limit));
  }

  public retrieveKnowledge(
    query: string,
    limit = DEFAULT_RESULT_LIMIT,
  ): RetrievedDocumentationSection[] {
    return this.retrieve(query, this.sections.length)
      .filter(({ content }) => !isPortalNavigationSection(content))
      .slice(0, limit);
  }

  public formatContext(
    sections: readonly RetrievedDocumentationSection[],
  ): string {
    const knowledgeSections = sections.filter(
      ({ content }) => !isPortalNavigationSection(content),
    );
    if (knowledgeSections.length === 0) return "";

    const maxSectionCharacters = Math.floor(
      MAX_CONTEXT_CHARACTERS / knowledgeSections.length,
    );

    return knowledgeSections
      .map(({ content }) => content.slice(0, maxSectionCharacters))
      .join("\n\n---\n\n")
      .slice(0, MAX_CONTEXT_CHARACTERS);
  }

  /** Resolves direct knowledge-base answers that must not be embellished. */
  public resolveKnowledgeAnswer(
    query: string,
  ): KnowledgeBaseAnswer | undefined {
    const sections = this.retrieve(query, this.sections.length).filter(
      ({ content }) => !isPortalNavigationSection(content),
    );

    if (CUSTOMER_SUPPORT_REQUEST_PATTERN.test(query)) {
      const answer = customerSupportAnswerFrom(this.sections);
      return answer ? { answer } : undefined;
    }

    if (!POLICY_DOCUMENT_REQUEST_PATTERN.test(query)) return undefined;

    const section = sections.find(({ content, heading }) =>
      /download[\s\S]*policy\s+documents?|policy\s+documents?[\s\S]*download/i.test(
        `${heading}\n${content}`,
      ),
    );
    if (!section) return undefined;

    const answer = answerBodyFrom(section.content);
    return answer ? { answer } : undefined;
  }

  /** Resolves a portal-navigation entry from the indexed Markdown knowledge. */
  public resolvePortalNavigation(
    query: string,
  ): PortalNavigationKnowledgeResult | undefined {
    if (POLICY_DOCUMENT_REQUEST_PATTERN.test(query)) return undefined;

    const navigationSection = bestPortalNavigationSection(
      query,
      this.retrieve(query, this.sections.length),
    );
    if (!navigationSection) return undefined;
    if (!isPortalNavigationRequest(query, navigationSection)) return undefined;

    const message = fieldValue(navigationSection.content, "Message");
    const template = fieldValue(navigationSection.content, "URL");
    if (!message || !template) return undefined;

    const parameters = [...template.matchAll(/\{([^}]+)\}/g)].map(
      (match) => match[1],
    );
    const contractId = contractIdFrom(query);
    if (parameters.includes("contractId") && !contractId) {
      if (isContractListRequest(query)) return undefined;
      return {
        linkText: sectionHeading(navigationSection.content),
        message,
        missingParameter: "contractId",
      };
    }

    return {
      linkText: sectionHeading(navigationSection.content),
      message,
      url: template.replaceAll(
        "{contractId}",
        encodeURIComponent(contractId ?? ""),
      ),
    };
  }
}
