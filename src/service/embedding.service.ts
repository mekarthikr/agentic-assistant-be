import { embed, embedMany } from "ai";

import { env } from "@app/config/env";

interface EmbeddingGenerator {
  generate(texts: string[]): Promise<number[][]>;
}

/** One embedding implementation shared by ingestion and retrieval. */
export class EmbeddingService {
  public readonly model: string;
  private readonly embeddingFunction: EmbeddingGenerator;

  public constructor(
    embeddingFunction?: EmbeddingGenerator,
    model = env.RAG_EMBEDDING_MODEL,
  ) {
    this.model = model;
    this.embeddingFunction = embeddingFunction ?? {
      generate: async (texts) => {
        if (texts.length === 1) {
          const result = await embed({ model: this.model, value: texts[0] });
          return [result.embedding];
        }
        const result = await embedMany({ model: this.model, values: texts });
        return result.embeddings;
      },
    };
  }

  public async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embeddingFunction.generate([text]);
    if (!embedding?.length)
      throw new Error("Embedding provider returned no vector.");
    return embedding;
  }

  public async embedMany(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const embeddings = await this.embeddingFunction.generate([...texts]);
    if (embeddings.length !== texts.length) {
      throw new Error(
        "Embedding count did not match the document chunk count.",
      );
    }
    return embeddings;
  }
}
