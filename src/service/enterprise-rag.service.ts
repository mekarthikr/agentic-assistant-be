import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EnterpriseEndpoint,
  EnterpriseEndpointParameter,
} from "@app/types";
import { flowTracer } from "@app/observability";

const INDEX_VERSION = 3;
const DEFAULT_RESULT_LIMIT = 3;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "what",
  "when",
  "where",
  "who",
  "with",
  "you",
  "your",
]);

type SparseVector = Record<string, number>;

interface StoredEntry {
  endpoint: EnterpriseEndpoint;
  vector: SparseVector;
}

interface StoredIndex {
  version: number;
  sourceHash: string;
  createdAt: string;
  inverseDocumentFrequency: SparseVector;
  entries: StoredEntry[];
}

export interface EnterpriseRetrieval {
  context: string;
  toolNames: string[];
}

/** Splits text into normalized searchable terms and removes common filler words. */
const tokenize = (value: string): string[] =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.map((token) =>
      token
        .replace(/(applications?|approval|approved)$/i, "approv")
        .replace(/(contracts?)$/i, "contract"),
    )
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [];

/** Scales a sparse vector to unit length for cosine-similarity comparison. */
const normalize = (weights: SparseVector): SparseVector => {
  const magnitude = Math.sqrt(
    Object.values(weights).reduce((sum, value) => sum + value * value, 0),
  );
  if (!magnitude) return weights;
  return Object.fromEntries(
    Object.entries(weights).map(([term, weight]) => [term, weight / magnitude]),
  );
};

/** Builds a normalized TF-IDF sparse vector for a block of text. */
const vectorize = (text: string, idf: SparseVector): SparseVector => {
  const counts = new Map<string, number>();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return normalize(
    Object.fromEntries(
      [...counts].map(([term, count]) => [
        term,
        (1 + Math.log(count)) * (idf[term] ?? 0),
      ]),
    ),
  );
};

/** Calculates similarity for vectors that have already been normalized. */
const cosineSimilarity = (left: SparseVector, right: SparseVector): number =>
  Object.entries(left).reduce(
    (score, [term, weight]) => score + weight * (right[term] ?? 0),
    0,
  );

/** Converts an HTTP method and path into a stable model-safe tool identifier. */
const toToolId = (method: string, endpointPath: string): string => {
  const pathParts = endpointPath
    .replace(/^\/api\/v1(?=\/|$)/i, "")
    .split("/")
    .filter(Boolean)
    .map((part) => {
      const parameter = /^:(.+)$/.exec(part) ?? /^\{(.+)\}$/.exec(part);
      return parameter ? `by_${parameter[1]}` : part;
    });

  return [method.toLowerCase(), ...pathParts]
    .join("_")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase();
};

/**
 * Parses one documented path or query parameter bullet.
 *
 * @param line - Markdown list item containing a parameter definition.
 * @param location - Whether the parameter belongs in the URL path or query.
 */
const parseParameter = (
  line: string,
  location: "path" | "query",
): EnterpriseEndpointParameter | null => {
  const match = /^-\s+`([^`]+)`(?:\s+\([^)]*\))?\s*(?:—|â€”|-)\s*(.+)$/u.exec(
    line.trim(),
  );
  if (!match) return null;

  return {
    name: match[1],
    type: "string",
    location,
    required: location === "path" || /\brequired\b/i.test(line),
    description: match[2].trim(),
  };
};

/** Parses parameter rows from one endpoint's Markdown table. */
const parseParameterTable = (
  section: string,
  location: "path" | "query",
): EnterpriseEndpointParameter[] =>
  section.split(/\r?\n/).flatMap((line) => {
    if (!line.trim().startsWith("|")) return [];
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim().replace(/`/g, ""));
    if (
      cells.length < 4 ||
      /^parameter$/i.test(cells[0]) ||
      /^-+$/.test(cells[0])
    ) {
      return [];
    }

    return [
      {
        name: cells[0],
        type: "string",
        location,
        required: location === "path" || /^yes$/i.test(cells[2]),
        description: cells[3],
      },
    ];
  });

/** Parses the endpoint-oriented RAG documentation format. */
const parseEndpointSections = (markdown: string): EnterpriseEndpoint[] => {
  const endpoints: EnterpriseEndpoint[] = [];
  const endpointPattern =
    /^## Endpoint:\s*(.+)\r?\n([\s\S]*?)(?=^## Endpoint:|(?![\s\S]))/gm;

  for (const match of markdown.matchAll(endpointPattern)) {
    const title = match[1].trim();
    const documentation = match[2].trim();
    const requestSection =
      /^### Request\s*\r?\n([\s\S]*?)(?=^###\s|(?![\s\S]))/im.exec(
        documentation,
      )?.[1] ?? "";
    const endpointMatch = /```http\s*\r?\n\s*([A-Z]+)\s+([^\s`]+)/i.exec(
      requestSection,
    );
    if (!endpointMatch) continue;

    const description =
      /^### Intent\s*\r?\n([\s\S]*?)(?=^###\s|(?![\s\S]))/im
        .exec(documentation)?.[1]
        .trim()
        .replace(/\s+/g, " ") ?? title;
    const parameters: EnterpriseEndpointParameter[] = [];
    const parameterSectionPattern =
      /^###\s+(Supported query parameters|Path parameters?)\s*\r?\n([\s\S]*?)(?=^###\s|(?![\s\S]))/gim;

    for (const parameterMatch of documentation.matchAll(
      parameterSectionPattern,
    )) {
      const location = /^supported query/i.test(parameterMatch[1])
        ? "query"
        : "path";
      parameters.push(...parseParameterTable(parameterMatch[2], location));
    }

    const method = endpointMatch[1].toUpperCase();
    const endpointPath = endpointMatch[2].split(/[?#]/, 1)[0].trim();
    endpoints.push({
      id: toToolId(method, endpointPath),
      title,
      method,
      path: endpointPath,
      description,
      parameters,
      documentation: `${title}\n${documentation}`,
    });
  }

  return endpoints;
};

/** Parses documented operations without knowing any enterprise resource names. */
export const parseEnterpriseApiDocumentation = (
  markdown: string,
): EnterpriseEndpoint[] => {
  const endpointSections = parseEndpointSections(markdown);
  if (endpointSections.length) return endpointSections;

  const sections = markdown.split(/^###\s+/m).slice(1);

  return sections.flatMap((section) => {
    const lines = section.split(/\r?\n/);
    const title = lines.shift()?.trim() ?? "";
    const documentation = lines.join("\n").trim();
    const endpointMatch = /\*\*Endpoint:\*\*\s*`([A-Z]+)\s+([^`]+)`/i.exec(
      documentation,
    );
    if (!endpointMatch) return [];

    const description =
      /\*\*Description:\*\*\s*([^\r\n]+)/i.exec(documentation)?.[1].trim() ??
      title;
    const parameters: EnterpriseEndpointParameter[] = [];
    let location: "path" | "query" | null = null;

    for (const line of lines) {
      if (/^\*\*Filterable Fields:\*\*/i.test(line)) {
        location = "query";
        continue;
      }
      if (/^\*\*Path Parameters:\*\*/i.test(line)) {
        location = "path";
        continue;
      }
      if (/^\*\*[^*]+:\*\*/.test(line)) location = null;
      if (!location) continue;
      const parameter = parseParameter(line, location);
      if (parameter) parameters.push(parameter);
    }

    const method = endpointMatch[1].toUpperCase();
    const endpointPath = endpointMatch[2].trim();
    return [
      {
        id: toToolId(method, endpointPath),
        title,
        method,
        path: endpointPath,
        description,
        parameters,
        documentation: `${title}\n${documentation}`,
      },
    ];
  });
};

/**
 * Persistent, deterministic sparse-vector RAG index for enterprise API docs.
 * The source hash makes the Markdown file the sole source of truth.
 */
export class EnterpriseRagService {
  private constructor(private readonly index: StoredIndex) {}

  /**
   * Loads a valid cached index or rebuilds it from the Markdown source.
   *
   * @param documentationPath - Absolute path to the source documentation.
   * @param indexPath - Absolute path used for the generated JSON index.
   */
  public static async load(
    documentationPath: string,
    indexPath: string,
  ): Promise<EnterpriseRagService> {
    const finishLoad = flowTracer.start({
      stage: "system",
      action: "rag.index.loading",
      summary: "Loading enterprise retrieval documentation and index.",
      details: { documentationPath, indexPath },
    });
    const markdown = await readFile(documentationPath, "utf8");
    const sourceHash = createHash("sha256").update(markdown).digest("hex");
    const cachedIndex = await this.readCachedIndex(indexPath);

    if (
      cachedIndex?.version === INDEX_VERSION &&
      cachedIndex.sourceHash === sourceHash
    ) {
      finishLoad({
        level: "success",
        action: "rag.index.cache_hit",
        summary: "The cached RAG index matched the documentation hash.",
        details: { endpointCount: cachedIndex.entries.length },
      });
      return new EnterpriseRagService(cachedIndex);
    }

    const index = this.buildIndex(markdown, sourceHash);
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    finishLoad({
      level: "success",
      action: "rag.index.rebuilt",
      summary: "The RAG index was rebuilt from enterprise documentation.",
      details: { endpointCount: index.entries.length },
    });
    return new EnterpriseRagService(index);
  }

  /** Returns endpoint definitions used to generate executable enterprise tools. */
  public getEndpoints(): EnterpriseEndpoint[] {
    return this.index.entries.map(({ endpoint }) => endpoint);
  }

  /**
   * Retrieves endpoint documentation that overlaps with the user's query.
   *
   * @param query - Recent user messages used as retrieval context.
   * @param limit - Maximum number of endpoint matches.
   * @returns Matching documentation and tool names, or `undefined` when unrelated.
   */
  public retrieve(
    query: string,
    limit = DEFAULT_RESULT_LIMIT,
  ): EnterpriseRetrieval | undefined {
    const queryVector = vectorize(query, this.index.inverseDocumentFrequency);
    const queryTerms = new Set(tokenize(query));
    const queryContainsIdentifier =
      /\b\d{3,}\b/.test(query) || /\b(?:id|number)\b/i.test(query);
    const queryTargetsApplications =
      /\b(?:application|approval|approved|submitted|rejected|in progress|anticipated premium|agent|contact)\b/i.test(
        query,
      );
    const queryTargetsContracts =
      !queryTargetsApplications &&
      /\b(?:contract|policy|current value|anniversary|issued|surrendered|distribution)\b/i.test(
        query,
      );
    const matches = this.index.entries
      .map((entry) => ({
        endpoint: entry.endpoint,
        score:
          cosineSimilarity(queryVector, entry.vector) +
          (queryTargetsApplications &&
          /\/applications(?:\/|$)/i.test(entry.endpoint.path)
            ? 0.3
            : 0) +
          (queryTargetsContracts &&
          /\/contracts(?:\/|$)/i.test(entry.endpoint.path)
            ? 0.2
            : 0) +
          (queryContainsIdentifier &&
          entry.endpoint.parameters.some(
            (parameter) =>
              parameter.location === "path" &&
              tokenize(parameter.name).some((term) => queryTerms.has(term)),
          )
            ? 0.25
            : 0),
      }))
      .sort((left, right) => right.score - left.score)
      .filter(({ score }) => score > 0)
      .slice(0, Math.max(1, limit));

    flowTracer.record({
      stage: "retrieval",
      level: "decision",
      action: "rag.scored",
      summary: matches.length
        ? `${matches.length} documented operation(s) passed the relevance threshold.`
        : "No documented operation passed the relevance threshold.",
      details: {
        query,
        queryContainsIdentifier,
        queryTargetsApplications,
        queryTargetsContracts,
        resultLimit: limit,
        matches: matches.map(({ endpoint, score }) => ({
          toolName: endpoint.id,
          method: endpoint.method,
          path: endpoint.path,
          score: Math.round(score * 10_000) / 10_000,
        })),
      },
    });

    if (!matches.length) return undefined;

    return {
      toolNames: matches.map(({ endpoint }) => endpoint.id),
      context: matches
        .map(({ endpoint }) =>
          [
            `${endpoint.title}: ${endpoint.method} ${endpoint.path}`,
            endpoint.description,
            ...endpoint.parameters.map(
              (parameter) =>
                `${parameter.location} parameter "${parameter.name}" (${parameter.required ? "required" : "optional"}): ${parameter.description}`,
            ),
          ].join("\n"),
        )
        .join("\n\n"),
    };
  }

  /** Reads a cached index, treating missing or malformed files as a cache miss. */
  private static async readCachedIndex(
    indexPath: string,
  ): Promise<StoredIndex | null> {
    try {
      return JSON.parse(await readFile(indexPath, "utf8")) as StoredIndex;
    } catch {
      return null;
    }
  }

  /** Parses documentation and computes the persisted TF-IDF index. */
  private static buildIndex(markdown: string, sourceHash: string): StoredIndex {
    const endpoints = parseEnterpriseApiDocumentation(markdown);
    if (!endpoints.length) {
      throw new Error(
        "No API endpoints were found in the enterprise documentation.",
      );
    }

    const tokenSets = endpoints.map(
      (endpoint) => new Set(tokenize(endpoint.documentation)),
    );
    const documentFrequency = new Map<string, number>();
    for (const tokens of tokenSets) {
      for (const token of tokens) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }

    const inverseDocumentFrequency = Object.fromEntries(
      [...documentFrequency].map(([term, frequency]) => [
        term,
        Math.log((endpoints.length + 1) / (frequency + 1)) + 1,
      ]),
    );

    return {
      version: INDEX_VERSION,
      sourceHash,
      createdAt: new Date().toISOString(),
      inverseDocumentFrequency,
      entries: endpoints.map((endpoint) => ({
        endpoint,
        vector: vectorize(endpoint.documentation, inverseDocumentFrequency),
      })),
    };
  }
}
