// Core retrieval: query parameters (stage 2). These are domain query DTOs, not
// outbound ports, so they live in core; the retrieval ports (application/ports)
// and the filtering logic both depend on them.

import { SourceKind } from "@core/model/source";
import { LanguageCode } from "@core/model/citation";

export interface RetrievalOptions {
  limit: number;
  includeWebResults: boolean;
  minScore?: number;
  sourceKinds?: SourceKind[];
  fileExtensions?: string[];
  sourcePaths?: string[];
  boostedSourcePaths?: string[];
  /** Restrict results to sources indexed in this language (resolved to sourcePaths by the retriever). */
  language?: string;
  /** Prefer breadth: keep at most one (top-scored) chunk per source. */
  diversify?: boolean;
  queryVariants?: RetrievalQueryVariant[];
}

export interface RetrievalQueryVariant {
  query: string;
  language?: LanguageCode;
  reason?: "original" | "expanded" | "translated";
}
