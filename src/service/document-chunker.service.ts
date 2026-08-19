import { env } from "@app/config/env";
import type { ParsedDocumentSection } from "@app/types";

const sentenceParts = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Boundary-aware character chunker with configurable overlap. */
export class DocumentChunkerService {
  public constructor(
    private readonly chunkSize = env.RAG_CHUNK_SIZE,
    private readonly overlap = env.RAG_CHUNK_OVERLAP,
  ) {
    if (overlap >= chunkSize) {
      throw new Error("RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_SIZE.");
    }
  }

  public chunk(
    sections: readonly ParsedDocumentSection[],
  ): ParsedDocumentSection[] {
    return sections.flatMap((section) =>
      this.chunkText(section.content).map((content) => ({
        ...section,
        content,
      })),
    );
  }

  private chunkText(text: string): string[] {
    const units = sentenceParts(text).flatMap((sentence) => {
      if (sentence.length <= this.chunkSize) return [sentence];
      const slices: string[] = [];
      for (let offset = 0; offset < sentence.length; offset += this.chunkSize) {
        slices.push(sentence.slice(offset, offset + this.chunkSize).trim());
      }
      return slices.filter(Boolean);
    });
    const chunks: string[] = [];
    let current = "";

    for (const unit of units) {
      const candidate = current ? `${current} ${unit}` : unit;
      if (candidate.length <= this.chunkSize) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      const overlapText = current.slice(-this.overlap).replace(/^\S*\s*/, "");
      current = overlapText ? `${overlapText} ${unit}` : unit;
      if (current.length > this.chunkSize) {
        chunks.push(current.slice(0, this.chunkSize));
        current = current.slice(this.chunkSize - this.overlap);
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }
}
