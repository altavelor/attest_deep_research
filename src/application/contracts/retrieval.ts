// Application boundary DTO (stage 1, task 3.1). Previously defined inside the
// concrete RetrievalService, which forced consumers (research/*) to depend on a
// concrete service just for its result shape. Lives here so use cases and
// pipelines depend on the contract, not the implementation.

import { Citation } from "@core/model";
import { RetrievedChunk } from "@core/model";
import { RetrievalQueryVariant } from "@core/retrieval";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  usedFallback: boolean;
  queryVariants?: RetrievalQueryVariant[];
}
