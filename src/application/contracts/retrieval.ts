// Application boundary DTO (stage 1, task 3.1). Previously defined inside the
// concrete RetrievalService, which forced consumers (research/*) to depend on a
// concrete service just for its result shape. Lives here so use cases and
// pipelines depend on the contract, not the implementation.

import { Citation } from "../../core/model/citation";
import { RetrievedChunk } from "../../core/model/source";
import { RetrievalQueryVariant } from "../../core/retrieval/query";

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  citations: Citation[];
  usedFallback: boolean;
  queryVariants?: RetrievalQueryVariant[];
}
