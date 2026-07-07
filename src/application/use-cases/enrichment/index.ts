// Публичный API модуля enrichment (SPEC-corpus-knowledge R3).

export { EnrichIndexSources } from "./EnrichIndexSources";
export type {
  EnrichIndexSourcesOptions,
  EnrichmentProgress,
  EnrichmentRunResult,
} from "./EnrichIndexSources";

export { normalizeReference, sharedReferences, toDocumentReference } from "./bibliography";
export { DEFAULT_CLAIM_CONCURRENCY, extractSourceClaims } from "./ClaimExtraction";
