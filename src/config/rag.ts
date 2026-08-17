import {
  ChromaService,
  DocumentChunkerService,
  DocumentParserService,
  DocumentRepository,
  DocumentService,
  EmbeddingService,
  RagService,
  RetrievalService,
} from "@app/service";
import { env } from "./env";

export const documentRepository = new DocumentRepository();
export const embeddingService = new EmbeddingService();
export const chromaService = new ChromaService();
export const documentService = new DocumentService(
  documentRepository,
  new DocumentParserService(),
  new DocumentChunkerService(),
  embeddingService,
  chromaService,
);
export const ragService = new RagService(
  new RetrievalService(documentRepository, embeddingService, chromaService, {
    topK: env.RAG_TOP_K,
    threshold: env.RAG_RELEVANCE_THRESHOLD,
  }),
);
