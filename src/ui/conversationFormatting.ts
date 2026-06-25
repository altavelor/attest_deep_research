// UI presentation formatters (stage 1, task 2.2). Split out of ui/rendering.ts.
// These are presentation-only: indexing status strings, citation link targets,
// and display content (which strips rendered citation IDs). They depend on UI/
// indexing concerns and therefore stay in the UI layer, not core/conversation.

import { IndexingState } from "../indexing/IndexingService";
import { formatIndexSize } from "../indexing/indexSize";
import { Citation } from "../shared/types";
import { ChatDisplayMessage, messageMarkdownContent } from "../core/conversation";
import { stripRenderedCitationIds } from "./citationText";

export type CitationTarget = { kind: "obsidian"; target: string } | { kind: "web"; target: string };

export function formatIndexingStatus(state?: IndexingState): string {
  if (!state) {
    return "Index status unavailable";
  }

  const status = formatIndexingStateLabel(state);
  const lastRun = state.lastIndexedAt ? formatDate(state.lastIndexedAt) : "no completed index run";

  if (state.indexedFiles === 0 && state.embeddedChunks === 0) {
    return `${status} · ${lastRun}`;
  }

  return `${status} · ${state.indexedFiles} indexed · ${state.embeddedChunks} chunks · last run ${lastRun}`;
}

export function formatIndexingStateLabel(state: IndexingState): string {
  if (state.status === "error") {
    return "Indexing failed";
  }

  if (state.isStale || state.status === "stale") {
    return "Rebuild needed";
  }

  return state.status[0].toUpperCase() + state.status.slice(1);
}

export function formatIndexControlSummary(state?: IndexingState): string {
  if (!state) {
    return "Index status unavailable";
  }

  const lastRun = state.lastIndexedAt ? formatDate(state.lastIndexedAt) : "Never indexed";

  if (state.status === "error") {
    return state.errorMessage
      ? `Indexing failed · ${state.errorMessage}`
      : `Indexing failed · ${lastRun}`;
  }

  return `${formatIndexingStateLabel(state)} · ${state.indexedFiles} files · ${formatIndexSize(
    state.indexSizeBytes ?? 0,
  )} · ${lastRun}`;
}

export function formatProgressPercent(progress: number): string {
  const bounded = Math.max(0, Math.min(1, progress));
  return `${Math.round(bounded * 100)}%`;
}

export function indexingProgressValue(state: IndexingState): number {
  if (
    state.phase === "embedding" &&
    isPositiveCount(state.chunksTotal) &&
    state.chunksEmbedded !== undefined
  ) {
    return state.chunksEmbedded / state.chunksTotal;
  }

  if (
    isPositiveCount(state.bytesTotal) &&
    state.bytesProcessed !== undefined &&
    (state.phase === "scanning" || state.phase === "checking" || state.phase === "extracting")
  ) {
    return state.bytesProcessed / state.bytesTotal;
  }

  return state.progress;
}

export function formatIndexingProgressLabel(state: IndexingState): string {
  if (state.phase === "embedding" && isPositiveCount(state.chunksTotal)) {
    const chunks = `${state.chunksEmbedded ?? 0} of ${state.chunksTotal} chunks`;
    const batches =
      state.embeddingBatchesTotal && state.embeddingBatchesCompleted !== undefined
        ? ` · ${state.embeddingBatchesCompleted} of ${state.embeddingBatchesTotal} batches`
        : "";

    return `${formatPhase(state.phase)} · ${chunks}${batches}${formatCurrentFile(state)}`;
  }

  return `${formatPhase(state.phase)} · ${state.scannedFiles} of ${state.totalFiles
    } files${formatCurrentFile(state)}`;
}

export function citationTarget(citation: Citation): CitationTarget {
  switch (citation.source.kind) {
    case "markdown":
      return {
        kind: "obsidian",
        target: citation.source.blockId
          ? `${citation.source.path}#^${citation.source.blockId}`
          : citation.source.path,
      };
    case "pdf":
      return {
        kind: "obsidian",
        target: `${citation.source.path}#page=${citation.source.pageNumber}`,
      };
    case "document":
      return { kind: "obsidian", target: citation.source.path };
    case "web":
      return { kind: "web", target: citation.source.url };
  }
}

export function messageDisplayContent(message: ChatDisplayMessage): string {
  if (message.role === "user") {
    return message.content;
  }

  return stripRenderedCitationIds(messageMarkdownContent(message)).trim();
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPhase(phase: IndexingState["phase"]): string {
  switch (phase) {
    case "scanning":
      return "Scanning";
    case "checking":
      return "Checking changes";
    case "extracting":
      return "Extracting";
    case "chunking":
      return "Chunking";
    case "embedding":
      return "Embedding";
    case "writing":
      return "Writing index";
    case "complete":
      return "Complete";
    default:
      return "Indexing";
  }
}

function formatCurrentFile(state: IndexingState): string {
  return state.currentFile ? ` · ${shortenPath(state.currentFile)}` : "";
}

function shortenPath(path: string): string {
  if (path.length <= 64) {
    return path;
  }

  return `...${path.slice(-61)}`;
}

function isPositiveCount(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
