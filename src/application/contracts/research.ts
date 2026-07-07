import { RetrievalResult } from "./retrieval";
import { RetrievalOptions, RetrievalQueryVariant } from "@core/retrieval";
import { ResearchAnswer } from "@core/answer";
import { ContextDiagnostics, ContextMode } from "@core/diagnostics";
import { LanguageInventoryItem } from "@core/model";
import { SourceReference } from "@core/model";
import { ResearchChatHistoryMessage } from "@core/research";
import {
  FindInIndexOptions,
  FindInIndexMatch,
  IndexChunkListItem,
  IndexChunkListOptions,
  IndexChunkReadOptions,
  IndexChunkReadResult,
  IndexSectionReadOptions,
  IndexSectionReadResult,
  IndexCursorPage,
  IndexMetadataSearchOptions,
  IndexSourceInventoryItem,
  IndexSourceInventoryOptions,
  IndexSourceOutline,
  IndexSourceSummary,
} from "@application/ports/retrieval";
import { SharedReference, SourceDocumentMetadata } from "@application/ports/documentMetadata";
import { SourceDocumentSummaries } from "@application/ports/documentSummaries";
import { ClaimGroup, FindClaimsOptions } from "@application/ports/documentClaims";

export interface IndexedUrlReference {
  id: string;
  url: string;
  normalizedUrl: string;
  purpose: string | null;
  context: string;
  chunkId: string;
  source: SourceReference;
}

export interface IndexedUrlInventoryOptions {
  cursor?: string;
  limit: number;
  sourcePath?: string;
}

export interface IndexedUrlInventoryResult {
  items: IndexedUrlReference[];
  nextCursor?: string;
}

export interface UrlStatusCheckRequest {
  url: string;
}

export interface UrlStatusCheckResult {
  url: string;
  state: "reachable" | "unreachable" | "unknown";
  ok: boolean;
  status?: number;
  statusText?: string;
  finalUrl?: string;
  error?: string;
}

export interface UrlStatusChecker {
  checkUrls(
    urls: UrlStatusCheckRequest[],
    options: { timeoutMs: number; signal: AbortSignal },
  ): Promise<UrlStatusCheckResult[]>;
}

export interface ResearchRetriever {
  search(query: string, options: RetrievalOptions): Promise<RetrievalResult>;
  getLanguageInventory?(): Promise<LanguageInventoryItem[]>;
  listIndexedUrls?(options: IndexedUrlInventoryOptions): Promise<IndexedUrlInventoryResult>;
  listIndexSources?(
    options: IndexSourceInventoryOptions,
  ): Promise<IndexCursorPage<IndexSourceInventoryItem>>;
  listIndexChunks?(options: IndexChunkListOptions): Promise<IndexCursorPage<IndexChunkListItem>>;
  readIndexChunk?(options: IndexChunkReadOptions): Promise<IndexChunkReadResult>;
  readIndexSection?(options: IndexSectionReadOptions): Promise<IndexSectionReadResult | null>;
  getSourceMetadata?(sourcePath: string): Promise<SourceDocumentMetadata | null>;
  getSourceSummary?(sourcePath: string): Promise<SourceDocumentSummaries | null>;
  listSharedReferences?(options: { minSources: number }): Promise<SharedReference[]>;
  findClaims?(options: FindClaimsOptions): Promise<ClaimGroup[]>;
  findInIndex?(options: FindInIndexOptions): Promise<IndexCursorPage<FindInIndexMatch>>;
  summarizeIndexSource?(sourcePath: string, maxSections: number): Promise<IndexSourceSummary | null>;
  getIndexSourceOutline?(sourcePath: string): Promise<IndexSourceOutline | null>;
  searchIndexByMetadata?(
    options: IndexMetadataSearchOptions,
  ): Promise<IndexCursorPage<IndexSourceInventoryItem>>;
}

/** Port for query expansion (concrete LLM-backed impl lives in adapters/retrieval). */
export interface QueryVariantsRequest {
  query: string;
  languageInventory: LanguageInventoryItem[];
}

export interface QueryExpansion {
  buildVariants(request: QueryVariantsRequest): Promise<RetrievalQueryVariant[]>;
}

export type { ResearchSearchMode } from "@core/research";
import type { ResearchSearchMode } from "@core/research";

export interface ResearchRequest {
  question: string;
  includeWebSearch?: boolean;
  searchMode?: ResearchSearchMode;
  contextPaths?: string[];
  contextMode?: ContextMode;
  activeFilePath?: string;
  includeActiveFile?: boolean;
  includeContextDiagnostics?: boolean;
  /** Set when the user explicitly requested the sub-agent via an `@run_subagent` mention. */
  forceSubAgent?: boolean;
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
    /** Set when this call is nested inside a parent tool-call (e.g. run_subagent). */
    parentId?: string;
  }
  | {
    type: "tool-call-end";
    id: string;
    ok: boolean;
    resolvedLabel?: string;
    resultSummary?: string;
    resultJson?: string;
    parentId?: string;
  }
  | { type: "sub-agent-phase"; parentId: string; phase: string }
  | { type: "answer-reset" }
  | { type: "context"; diagnostics: ContextDiagnostics }
  | { type: "complete"; answer: ResearchAnswer };

export type VaultQueryVariants = RetrievalQueryVariant[] | undefined;
