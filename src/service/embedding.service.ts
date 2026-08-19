import { GoogleGenAI } from "@google/genai";

import { env } from "@app/config/env";

interface EmbeddingGenerator {
  generate(texts: string[]): Promise<number[][]>;
}

const MAX_CONCURRENT_EMBEDDINGS = 5;

/** One embedding implementation shared by ingestion and retrieval. */
export class EmbeddingService {
  public readonly model: string;
  private readonly embeddingFunction: EmbeddingGenerator;

  public constructor(
    embeddingFunction?: EmbeddingGenerator,
    model = env.RAG_EMBEDDING_MODEL,
  ) {
    this.model = model;
    if (embeddingFunction) {
      this.embeddingFunction = embeddingFunction;
      return;
    }

    const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    this.embeddingFunction = {
      generate: async (texts) => {
        const embeddings = new Array<number[]>(texts.length);
        let nextIndex = 0;
        const workers = Array.from(
          { length: Math.min(MAX_CONCURRENT_EMBEDDINGS, texts.length) },
          async () => {
            while (nextIndex < texts.length) {
              const index = nextIndex++;
              const response = await ai.models.embedContent({
                model: this.model,
                contents: texts[index],
              });
              const embedding = response.embeddings?.[0]?.values;
              if (!embedding?.length) {
                throw new Error("Gemini returned no embedding vector.");
              }
              embeddings[index] = embedding;
            }
          },
        );
        await Promise.all(workers);
        return embeddings;
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
