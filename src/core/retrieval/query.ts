// Core retrieval: query parameters (stage 2). These are domain query DTOs, not
// outbound ports, so they live in core; the retrieval ports (application/ports)
// and the filtering logic both depend on them.

import { SourceKind } from "../model/source";
import { LanguageCode } from "../model/citation";

export interface RetrievalOptions {
  limit: number;
  includeWebResults: boolean;
  minScore?: number;
  sourceKinds?: SourceKind[];
  fileExtensions?: string[];
  sourcePaths?: string[];
  boostedSourcePaths?: string[];
  queryVariants?: RetrievalQueryVariant[];
}

export interface RetrievalQueryVariant {
  query: string;
  language?: LanguageCode;
  reason?: "original" | "expanded" | "translated";
}
