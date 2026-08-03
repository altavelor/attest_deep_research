import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { RetrievalQueryVariant } from "@core/retrieval";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  usedFallback: boolean;

  semanticError?: string;
  queryVariants?: RetrievalQueryVariant[];
}
