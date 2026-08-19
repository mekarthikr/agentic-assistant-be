import type { RagResult } from "@app/types";
import { logError } from "@app/utils/error-logger";
import type { RetrievalService } from "./retrieval.service";

export class RagService {
  public constructor(private readonly retrieval: RetrievalService) {}

  public async retrieve(input: {
    query: string;
    userId: string;
    documentIds?: readonly string[];
  }): Promise<RagResult> {
    try {
      const chunks = await this.retrieval.retrieve(input);
      return { chunks, context: this.buildContext(chunks) };
    } catch (error) {
      logError("Document RAG retrieval failed", error, {
        userId: input.userId,
        selectedDocumentCount: input.documentIds?.length ?? 0,
      });
      return { chunks: [], context: "", unavailable: true };
    }
  }

  private buildContext(chunks: RagResult["chunks"]): string {
    return chunks
      .map((chunk, index) => {
        const location = [
          `Document: ${chunk.documentName}`,
          chunk.page === undefined ? undefined : `Page: ${chunk.page}`,
          chunk.section ? `Section: ${chunk.section}` : undefined,
        ]
          .filter(Boolean)
          .join("\n");
        return `[SOURCE ${index + 1}]\n${location}\nContent:\n${chunk.content}`;
      })
      .join("\n\n");
  }
}
