export interface DocumentClaim {
  claimId: string;

  chunkId: string;
  sourcePath: string;

  subject: string;

  statement: string;

  topicKeys: string[];
}

export interface SourceDocumentClaims {
  schemaVersion: 1;
  sourcePath: string;

  contentHash: string;
  claims: DocumentClaim[];
  generation: {
    model: string;
    promptVersion: number;
    generatedAt: string;
  };
}

export interface DocumentClaimStore {
  read(sourcePath: string): Promise<SourceDocumentClaims | null>;
  write(claims: SourceDocumentClaims): Promise<void>;
  list(): Promise<SourceDocumentClaims[]>;
}

export interface ClaimExtractionInput {
  sourcePath: string;
  chunkId: string;
  headingPath: string[];
  text: string;
}

export interface ExtractedClaim {
  subject: string;
  statement: string;
  topicKeys: string[];
}

export interface ClaimExtractor {
  readonly model: string;
  readonly promptVersion: number;
  extract(input: ClaimExtractionInput): Promise<ExtractedClaim[]>;
}

export interface FindClaimsOptions {
  subject?: string;
  topic?: string;
  limit: number;
}

export interface ClaimGroup {
  subject: string;

  sourcePaths: string[];
  claims: DocumentClaim[];
}
