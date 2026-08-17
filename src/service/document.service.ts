import { randomUUID } from "node:crypto";

import type { DocumentChunk, DocumentRecord } from "@app/types";
import type { ChromaService } from "./chroma.service";
import type { DocumentChunkerService } from "./document-chunker.service";
import type { DocumentParserService } from "./document-parser.service";
import type { DocumentRepository } from "./document-repository.service";
import type { EmbeddingService } from "./embedding.service";

/** Coordinates durable status, parsing, one-time embedding, and vector writes. */
export class DocumentService {
  public constructor(
    private readonly repository: DocumentRepository,
    private readonly parser: DocumentParserService,
    private readonly chunker: DocumentChunkerService,
    private readonly embeddings: EmbeddingService,
    private readonly chroma: ChromaService,
  ) {}

  public list(userId: string): DocumentRecord[] {
    return this.repository.listOwned(userId);
  }

  public async ingest(input: {
    userId: string;
    name: string;
    mediaType: string;
    buffer: Buffer;
    documentId?: string;
  }): Promise<DocumentRecord> {
    const existing = input.documentId
      ? this.repository.findOwned(input.documentId, input.userId)
      : undefined;
    if (input.documentId && !existing) {
      throw new Error("Document was not found or is not accessible.");
    }
    const id = input.documentId ?? randomUUID();
    const now = new Date().toISOString();
    const record: DocumentRecord = {
      id,
      userId: input.userId,
      name: input.name,
      mediaType: input.mediaType,
      size: input.buffer.byteLength,
      status: input.documentId ? "processing" : "uploading",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.repository.replace(record);

    try {
      this.repository.updateStatus(id, input.userId, "processing");
      await this.chroma.deleteDocument(id, input.userId);
      const parsed = await this.parser.parse({
        name: input.name,
        buffer: input.buffer,
      });
      const chunks: DocumentChunk[] = this.chunker
        .chunk(parsed)
        .map((section, chunkIndex) => ({
          ...section,
          id: `${id}_chunk_${chunkIndex}`,
          documentId: id,
          documentName: input.name,
          userId: input.userId,
          chunkIndex,
        }));
      if (!chunks.length)
        throw new Error("The document produced no indexable text.");
      const vectors = await this.embeddings.embedMany(
        chunks.map(({ content }) => content),
      );
      await this.chroma.addChunks(chunks, vectors);
      return this.repository.updateStatus(id, input.userId, "ready")!;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Document processing failed.";
      this.repository.updateStatus(id, input.userId, "failed", message);
      throw error;
    }
  }

  public async delete(documentId: string, userId: string): Promise<boolean> {
    if (!this.repository.findOwned(documentId, userId)) return false;
    await this.chroma.deleteDocument(documentId, userId);
    return this.repository.deleteOwned(documentId, userId);
  }
}
