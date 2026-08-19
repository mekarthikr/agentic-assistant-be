import {
  ChromaClient,
  CloudClient,
  type Collection,
  type Metadata,
  type Where,
} from "chromadb";

import { env } from "@app/config/env";
import type { DocumentChunk, RetrievedDocumentChunk } from "@app/types";

const toWhere = (userId: string, documentIds?: readonly string[]): Where => {
  if (!documentIds?.length) return { userId };
  return {
    $and: [{ userId }, { documentId: { $in: [...documentIds] } }],
  } as Where;
};

/** Owns all Chroma collection access and tenant-scoped metadata filters. */
export class ChromaService {
  private readonly client: ChromaClient;
  private collectionPromise?: Promise<Collection>;

  public constructor(client?: ChromaClient) {
    this.client =
      client ??
      (env.CHROMA_API_KEY
        ? new CloudClient({
            apiKey: env.CHROMA_API_KEY,
            tenant: env.CHROMA_TENANT,
            database: env.CHROMA_DATABASE,
          })
        : new ChromaClient({
            host: env.CHROMA_HOST,
            port: env.CHROMA_PORT,
            ssl: env.CHROMA_SSL,
            ...(env.CHROMA_TENANT ? { tenant: env.CHROMA_TENANT } : {}),
            ...(env.CHROMA_DATABASE ? { database: env.CHROMA_DATABASE } : {}),
          }));
  }

  public getCollection(): Promise<Collection> {
    this.collectionPromise ??= this.createCollection();
    return this.collectionPromise;
  }

  private async createCollection(): Promise<Collection> {
    const collection = await this.client.getOrCreateCollection({
      name: env.CHROMA_COLLECTION,
      embeddingFunction: null,
      configuration: { hnsw: { space: "cosine" } },
      metadata: {
        embeddingModel: env.RAG_EMBEDDING_MODEL,
        distanceMetric: "cosine",
      },
    });
    const storedModel = collection.metadata?.embeddingModel;
    if (storedModel && storedModel !== env.RAG_EMBEDDING_MODEL) {
      throw new Error(
        `Chroma collection ${env.CHROMA_COLLECTION} uses embedding model ${String(storedModel)}; configure RAG_EMBEDDING_MODEL=${String(storedModel)} or re-index into a new collection.`,
      );
    }
    const space = collection.configuration.hnsw?.space;
    if (space && space !== "cosine") {
      throw new Error(
        `Chroma collection ${env.CHROMA_COLLECTION} must use cosine distance.`,
      );
    }
    return collection;
  }

  public async addChunks(
    chunks: readonly DocumentChunk[],
    embeddings: readonly number[][],
  ): Promise<void> {
    if (!chunks.length) return;
    if (chunks.length !== embeddings.length) {
      throw new Error("Every Chroma chunk must have one embedding.");
    }
    const collection = await this.getCollection();
    await collection.upsert({
      ids: chunks.map(({ id }) => id),
      documents: chunks.map(({ content }) => content),
      embeddings: embeddings.map((embedding) => [...embedding]),
      metadatas: chunks.map(
        ({ userId, documentId, documentName, page, section, chunkIndex }) => ({
          userId,
          documentId,
          documentName,
          chunkIndex,
          ...(page === undefined ? {} : { page }),
          ...(section ? { section } : {}),
        }),
      ),
    });
  }

  public async search(input: {
    embedding: readonly number[];
    userId: string;
    documentIds?: readonly string[];
    topK: number;
  }): Promise<RetrievedDocumentChunk[]> {
    const collection = await this.getCollection();
    const result = await collection.query({
      queryEmbeddings: [[...input.embedding]],
      nResults: input.topK,
      where: toWhere(input.userId, input.documentIds),
      include: ["documents", "metadatas", "distances"],
    });
    const documents = result.documents[0] ?? [];
    const metadatas = result.metadatas[0] ?? [];
    const distances = result.distances?.[0] ?? [];

    return documents.flatMap((content, index) => {
      const metadata = metadatas[index] as Metadata | null;
      if (
        typeof content !== "string" ||
        !metadata ||
        metadata.userId !== input.userId ||
        typeof metadata.documentId !== "string" ||
        typeof metadata.documentName !== "string"
      ) {
        return [];
      }
      const page = metadata.page;
      const section = metadata.section;
      const distance = distances[index];
      return [
        {
          content,
          documentId: metadata.documentId,
          documentName: metadata.documentName,
          ...(typeof page === "number" ? { page } : {}),
          ...(typeof section === "string" ? { section } : {}),
          ...(typeof distance === "number" ? { distance } : {}),
        },
      ];
    });
  }

  public async deleteDocument(
    documentId: string,
    userId: string,
  ): Promise<void> {
    const collection = await this.getCollection();
    await collection.delete({
      where: { $and: [{ userId }, { documentId }] } as Where,
    });
  }

  public async deleteUserDocuments(userId: string): Promise<void> {
    const collection = await this.getCollection();
    await collection.delete({ where: { userId } });
  }
}
