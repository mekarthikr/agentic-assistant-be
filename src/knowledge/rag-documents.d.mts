export interface BuiltKnowledgeSource {
  readonly filename: string;
  readonly title: string;
  readonly mediaType: string;
  readonly page?: number;
  readonly chunkIndex: number;
  readonly isContentsPage?: boolean;
  readonly ragEligible: boolean;
}

export interface BuiltKnowledgeSection {
  readonly heading: string;
  readonly content: string;
  readonly source: BuiltKnowledgeSource;
  readonly headingTokens: readonly string[];
  readonly contentTokens: readonly string[];
}

export interface BuiltKnowledgeIndex {
  readonly version: 4;
  readonly sources: readonly string[];
  readonly sourceHash: string;
  readonly sections: readonly BuiltKnowledgeSection[];
}

export function buildKnowledgeIndex(options?: {
  readonly knowledgeDirectoryUrl?: URL;
}): Promise<BuiltKnowledgeIndex>;
