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

  language?: string;

  diversify?: boolean;
  /**
   * Additional queries fused with the original one. A pending promise lets the
   * retriever start the original query immediately and fold late variants in
   * once they arrive; a rejected promise degrades to the original query alone.
   */
  queryVariants?: RetrievalQueryVariant[] | Promise<RetrievalQueryVariant[] | undefined>;
}

export interface RetrievalQueryVariant {
  query: string;
  language?: LanguageCode;
  reason?: "original" | "expanded" | "translated";
}
