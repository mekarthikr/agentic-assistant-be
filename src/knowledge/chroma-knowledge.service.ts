import {
  ChromaCloudQwenEmbeddingFunction,
  ChromaCloudQwenEmbeddingModel,
} from "@chroma-core/chroma-cloud-qwen";
import { CloudClient, type Collection, type Metadata } from "chromadb";

import { env } from "@app/config";
import { logError } from "@app/utils/error-logger";
import generatedIndex from "./enterprise-api-rag.json" with { type: "json" };
import type {
  RetrievedDocumentationSection,
  RetrievedDocumentationSource,
} from "./api-documentation-rag";

const QUERY_RESULT_LIMIT = 6;
const INGEST_BATCH_SIZE = 50;
const EMBEDDING_TASK = "insurance_support_retrieval";
const EMBEDDING_INSTRUCTIONS = {
  [EMBEDDING_TASK]: {
    documents:
      "Represent this insurance support procedure or reference for retrieval.",
    query:
      "Retrieve the insurance support procedure or reference that answers this question.",
  },
};

interface IndexedSection {
  readonly heading: string;
  readonly content: string;
  readonly source: RetrievedDocumentationSource;
}

interface GeneratedIndex {
  readonly sourceHash: string;
  readonly sections: readonly IndexedSection[];
}

export interface ReindexResult {
  readonly collection: string;
  readonly indexedSections: number;
  readonly removedSections: number;
  readonly sourceHash: string;
}

const index = generatedIndex as GeneratedIndex;

const toRecordId = (section: IndexedSection, position: number): string =>
  `${section.source.filename}:${section.source.page ?? 0}:${position}`;

const toMetadata = (section: IndexedSection, position: number): Metadata => ({
  heading: section.heading,
  filename: section.source.filename,
  title: section.source.title,
  mediaType: section.source.mediaType,
  page: section.source.page ?? 0,
  position,
  sourceHash: index.sourceHash,
});

const sourceFrom = (metadata: Metadata): RetrievedDocumentationSource => ({
  filename: String(metadata.filename),
  title: String(metadata.title),
  mediaType: String(metadata.mediaType),
  ...(Number(metadata.page) > 0 ? { page: Number(metadata.page) } : {}),
});

/** Chroma Cloud-backed semantic retrieval and idempotent knowledge indexing. */
export class ChromaKnowledgeService {
  private readonly client?: CloudClient;
  private readonly embeddingFunction?: ChromaCloudQwenEmbeddingFunction;
  private collectionPromise?: Promise<Collection>;
  private indexingPromise?: Promise<ReindexResult>;

  public constructor() {
    if (!env.CHROMA_API_KEY) return;

    this.client = new CloudClient({
      apiKey: env.CHROMA_API_KEY,
      tenant: env.CHROMA_TENANT,
      database: env.CHROMA_DATABASE,
    });
    this.embeddingFunction = new ChromaCloudQwenEmbeddingFunction({
      apiKeyEnvVar: "CHROMA_API_KEY",
      client: this.client,
      model: ChromaCloudQwenEmbeddingModel.QWEN3_EMBEDDING_0p6B,
      task: EMBEDDING_TASK,
      instructions: EMBEDDING_INSTRUCTIONS,
    });
  }

  public get configured(): boolean {
    return Boolean(this.client && this.embeddingFunction);
  }

  public async retrieve(
    query: string,
    limit = QUERY_RESULT_LIMIT,
  ): Promise<RetrievedDocumentationSection[]> {
    if (!this.configured || limit <= 0) return [];

    try {
      const collection = await this.getCollection();
      const result = await collection.query({
        queryTexts: [query],
        nResults: limit,
        include: ["documents", "metadatas", "distances"],
      });

      return (result.documents[0] ?? []).flatMap((document, position) => {
        const metadata = result.metadatas[0]?.[position];
        const distance = result.distances[0]?.[position];
        if (!document || !metadata || distance === null) return [];

        return [
          {
            heading: String(metadata.heading),
            content: document,
            score: 1 / (1 + Math.max(distance ?? 0, 0)),
            source: sourceFrom(metadata),
          },
        ];
      });
    } catch (error) {
      logError(
        "Chroma knowledge retrieval failed; using local fallback",
        error,
      );
      return [];
    }
  }

  public reindex(): Promise<ReindexResult> {
    if (!this.configured) {
      return Promise.reject(
        new Error("CHROMA_API_KEY must be configured before indexing."),
      );
    }
    if (this.indexingPromise) return this.indexingPromise;

    this.indexingPromise = this.performReindex().finally(() => {
      this.indexingPromise = undefined;
    });
    return this.indexingPromise;
  }

  private async getCollection(): Promise<Collection> {
    if (!this.client || !this.embeddingFunction) {
      throw new Error("Chroma Cloud is not configured.");
    }

    this.collectionPromise ??= this.client.getOrCreateCollection({
      name: env.CHROMA_COLLECTION,
      embeddingFunction: this.embeddingFunction,
      metadata: { sourceHash: index.sourceHash },
    });
    return this.collectionPromise;
  }

  private async performReindex(): Promise<ReindexResult> {
    const collection = await this.getCollection();
    const ids = index.sections.map(toRecordId);
    const current = await collection.get({ include: [] });

    for (
      let offset = 0;
      offset < index.sections.length;
      offset += INGEST_BATCH_SIZE
    ) {
      const batch = index.sections.slice(offset, offset + INGEST_BATCH_SIZE);
      await collection.upsert({
        ids: batch.map((section, position) =>
          toRecordId(section, offset + position),
        ),
        documents: batch.map(({ content }) => content),
        metadatas: batch.map((section, position) =>
          toMetadata(section, offset + position),
        ),
      });
    }

    const expectedIds = new Set(ids);
    const staleIds = current.ids.filter((id) => !expectedIds.has(id));
    if (staleIds.length > 0) await collection.delete({ ids: staleIds });
    await collection.modify({ metadata: { sourceHash: index.sourceHash } });

    return {
      collection: env.CHROMA_COLLECTION,
      indexedSections: ids.length,
      removedSections: staleIds.length,
      sourceHash: index.sourceHash,
    };
  }
}

export const chromaKnowledgeService = new ChromaKnowledgeService();
