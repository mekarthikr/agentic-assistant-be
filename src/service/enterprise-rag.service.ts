import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  EnterpriseEndpoint,
  EnterpriseEndpointParameter,
} from "../types/index.js";

const INDEX_VERSION = 1;
const DEFAULT_RESULT_LIMIT = 3;

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
    .filter((token) => token.length > 1) ?? [];

const normalize = (weights: SparseVector): SparseVector => {
  const magnitude = Math.sqrt(
    Object.values(weights).reduce((sum, value) => sum + value * value, 0),
  );
  if (!magnitude) return weights;
  return Object.fromEntries(
    Object.entries(weights).map(([term, weight]) => [term, weight / magnitude]),
  );
};

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

const cosineSimilarity = (left: SparseVector, right: SparseVector): number =>
  Object.entries(left).reduce(
    (score, [term, weight]) => score + weight * (right[term] ?? 0),
    0,
  );

const toToolId = (method: string, endpointPath: string): string => {
  const pathParts = endpointPath
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
    location,
    required: location === "path" || /\brequired\b/i.test(line),
    description: match[2].trim(),
  };
};

/** Parses documented operations without knowing any enterprise resource names. */
export const parseEnterpriseApiDocumentation = (
  markdown: string,
): EnterpriseEndpoint[] => {
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

  public static async load(
    documentationPath: string,
    indexPath: string,
  ): Promise<EnterpriseRagService> {
    const markdown = await readFile(documentationPath, "utf8");
    const sourceHash = createHash("sha256").update(markdown).digest("hex");
    const cachedIndex = await this.readCachedIndex(indexPath);

    if (
      cachedIndex?.version === INDEX_VERSION &&
      cachedIndex.sourceHash === sourceHash
    ) {
      return new EnterpriseRagService(cachedIndex);
    }

    const index = this.buildIndex(markdown, sourceHash);
    await mkdir(path.dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return new EnterpriseRagService(index);
  }

  public getEndpoints(): EnterpriseEndpoint[] {
    return this.index.entries.map(({ endpoint }) => endpoint);
  }

  public retrieve(
    query: string,
    limit = DEFAULT_RESULT_LIMIT,
  ): EnterpriseRetrieval {
    const queryVector = vectorize(query, this.index.inverseDocumentFrequency);
    const queryTerms = new Set(tokenize(query));
    const queryContainsIdentifier =
      /\b\d{3,}\b/.test(query) || /\b(?:id|number)\b/i.test(query);
    const matches = this.index.entries
      .map((entry) => ({
        endpoint: entry.endpoint,
        score:
          cosineSimilarity(queryVector, entry.vector) +
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
      .slice(0, Math.max(1, limit));

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

  private static async readCachedIndex(
    indexPath: string,
  ): Promise<StoredIndex | null> {
    try {
      return JSON.parse(await readFile(indexPath, "utf8")) as StoredIndex;
    } catch {
      return null;
    }
  }

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
