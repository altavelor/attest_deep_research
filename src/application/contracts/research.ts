import { RetrievalResult } from "./retrieval";
import { RetrievalOptions, RetrievalQueryVariant } from "../ports/retrieval";
import { ResearchAnswer } from "../../core/answer";
import { ContextDiagnostics, ContextMode } from "../../core/diagnostics";
import { LanguageInventoryItem } from "../../core/model/citation";
import { ResearchChatHistoryMessage } from "../../core/research/prompts";

export interface ResearchRetriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievalResult>;
  getLanguageInventory?(): Promise<LanguageInventoryItem[]>;
  expandAdjacentEvidence?(
    chunks: RetrievalResult["chunks"],
    radius: number,
    limit: number,
  ): Promise<RetrievalResult["chunks"]>;
}

/** Port for query expansion (concrete LLM-backed impl lives in adapters/retrieval). */
export interface QueryVariantsRequest {
  query: string;
  languageInventory: LanguageInventoryItem[];
}

export interface QueryExpansion {
  buildVariants(request: QueryVariantsRequest): Promise<RetrievalQueryVariant[]>;
}

export type { ResearchSearchMode } from "../../core/research/searchMode";
import type { ResearchSearchMode } from "../../core/research/searchMode";

export interface ResearchRequest {
  question: string;
  includeWebSearch?: boolean;
  searchMode?: ResearchSearchMode;
  contextPaths?: string[];
  contextMode?: ContextMode;
  activeFilePath?: string;
  includeActiveFile?: boolean;
  includeContextDiagnostics?: boolean;
  expandedEvidence?: RetrievalResult["chunks"];
  expandedCitationKeys?: string[];
  deepResearch?: boolean;
  chatHistory?: ResearchChatHistoryMessage[];
  signal?: AbortSignal;
}

export type ResearchStreamEvent =
  | { type: "status"; message: string }
  | { type: "delta"; content: string }
  | { type: "reasoning"; segmentId: string; content: string }
  | { type: "checkpoint-delta"; checkpointId: string; round: number; content: string }
  | { type: "checkpoint-complete"; checkpointId: string; round: number }
  | { type: "checkpoint-promote"; checkpointId: string; round: number }
  | {
    type: "tool-call-start";
    id: string;
    name: string;
    label: string;
    round: number;
    args?: Record<string, unknown>;
  }
  | {
    type: "tool-call-end";
    id: string;
    ok: boolean;
    resolvedLabel?: string;
    resultSummary?: string;
    resultJson?: string;
  }
  | { type: "answer-reset" }
  | { type: "context"; diagnostics: ContextDiagnostics }
  | { type: "complete"; answer: ResearchAnswer };

export type VaultQueryVariants = RetrievalQueryVariant[] | undefined;
