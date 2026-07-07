// Ports for the claim index (SPEC-corpus-knowledge R7): during index enrichment
// each content section yields short, normalized claims, stored as a per-source
// sidecar. A later LLM judge compares claims about the same subject across
// documents to surface contradictions — cheap extraction now, expensive judging
// only over pre-grouped candidates.

export interface DocumentClaim {
  claimId: string;
  /** The index chunk the claim was extracted from — for verbatim re-reading. */
  chunkId: string;
  sourcePath: string;
  /** Normalized entity/topic the claim is about (grouping key). */
  subject: string;
  /** The claim as a single self-contained sentence. */
  statement: string;
  /** Free normalized topic tags (e.g. "privacy.mail-forwarding") for coarse retrieval. */
  topicKeys: string[];
}

export interface SourceDocumentClaims {
  schemaVersion: 1;
  sourcePath: string;
  /** contentHash of the source at generation time — drives incremental re-runs. */
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

/** One content section handed to the extractor. */
export interface ClaimExtractionInput {
  sourcePath: string;
  chunkId: string;
  headingPath: string[];
  text: string;
}

/** A claim as produced by the extractor, before the store assigns provenance. */
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

/** Query for {@link find_claims}: match by subject and/or topic, bounded. */
export interface FindClaimsOptions {
  subject?: string;
  topic?: string;
  limit: number;
}

/** Claims about one subject, gathered across documents (contradiction candidates). */
export interface ClaimGroup {
  subject: string;
  /** Distinct source paths represented in this group. */
  sourcePaths: string[];
  claims: DocumentClaim[];
}
