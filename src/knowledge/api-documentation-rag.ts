import generatedIndex from "./enterprise-api-rag.json" with { type: "json" };

const DEFAULT_RESULT_LIMIT = 1;
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
}

interface DocumentationSection {
  readonly heading: string;
  readonly content: string;
  readonly headingTokens: readonly string[];
  readonly contentTokens: readonly string[];
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
      };
    });

const loadGeneratedIndex = (): readonly DocumentationSection[] => {
  const index = generatedIndex as GeneratedDocumentationIndex;

  if (
    index.version !== 2 ||
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
      }))
      .filter(({ score }) => score >= MINIMUM_RELEVANCE_SCORE)
      .sort(
        (left, right) =>
          right.score - left.score || left.heading.localeCompare(right.heading),
      )
      .slice(0, limit);
  }

  public retrieveContext(query: string, limit = DEFAULT_RESULT_LIMIT): string {
    const sections = this.retrieve(query, limit);
    if (sections.length === 0) return "";

    return sections
      .map(({ content }) => content)
      .join("\n\n---\n\n")
      .slice(0, MAX_CONTEXT_CHARACTERS);
  }
}
