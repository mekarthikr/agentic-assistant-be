import type { RetrievedDocumentChunk } from "@app/types";
import type { ChromaService } from "./chroma.service";
import type { DocumentRepository } from "./document-repository.service";
import type { EmbeddingService } from "./embedding.service";

export class RetrievalService {
  public constructor(
    private readonly repository: DocumentRepository,
    private readonly embeddings: EmbeddingService,
    private readonly chroma: ChromaService,
    private readonly options: { topK: number; threshold: number } = {
      topK: 5,
      threshold: 0.45,
    },
  ) {}

  public async retrieve(input: {
    query: string;
    userId: string;
    documentIds?: readonly string[];
  }): Promise<RetrievedDocumentChunk[]> {
    const ready = this.repository.listReadyOwned(
      input.userId,
      input.documentIds,
    );
    if (input.documentIds?.length) {
      const readyIds = new Set(ready.map(({ id }) => id));
      if (input.documentIds.some((id) => !readyIds.has(id))) {
        throw new Error(
          "A selected document is unavailable or not accessible.",
        );
      }
    }
    if (!ready.length) return [];

    const queryEmbedding = await this.embeddings.embed(input.query);
    const results = await this.chroma.search({
      embedding: queryEmbedding,
      userId: input.userId,
      documentIds: ready.map(({ id }) => id),
      topK: this.options.topK,
    });
    return results.filter(
      ({ distance }) =>
        typeof distance === "number" && distance <= this.options.threshold,
    );
  }
}
