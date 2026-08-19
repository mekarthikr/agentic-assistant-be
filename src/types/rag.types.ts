export type RagMode = "document-only" | "hybrid";

export type DocumentStatus = "uploading" | "processing" | "ready" | "failed";

export interface DocumentRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
  readonly status: DocumentStatus;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ParsedDocumentSection {
  readonly content: string;
  readonly page?: number;
  readonly section?: string;
}

export interface DocumentChunk extends ParsedDocumentSection {
  readonly id: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly userId: string;
  readonly chunkIndex: number;
}

export interface RetrievedDocumentChunk {
  readonly content: string;
  readonly documentId: string;
  readonly documentName: string;
  readonly page?: number;
  readonly section?: string;
  /** Internal cosine distance. Lower values are more relevant. */
  readonly distance?: number;
}

export interface RagResult {
  readonly context: string;
  readonly chunks: readonly RetrievedDocumentChunk[];
  readonly unavailable?: boolean;
}
