import { IndexingState } from "@adapters/indexing";
import { DEFAULT_LOCALE } from "@core/i18n";
import type { LocaleCode } from "@core/i18n";
import { Citation } from "@core/model";
import { ChatDisplayMessage } from "@core/conversation";
import { messageMarkdownContent } from "@core/conversation";
import { citationTarget as citationTargetString } from "@application/use-cases/research";
import type { Translate } from "@adapters/i18n";
import { stripRenderedCitationIds } from "./citations/citationText";

export type CitationTarget = { kind: "obsidian"; target: string } | { kind: "web"; target: string };

export function formatIndexingStatus(
  state: IndexingState | undefined,
  t: Translate,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  if (!state) {
    return t("chat.indexing.statusUnavailable");
  }

  const status = formatIndexingStateLabel(state, t);
  const lastRun = state.lastIndexedAt
    ? formatDate(state.lastIndexedAt, locale)
    : t("chat.indexing.noCompletedRun");

  if (state.indexedFiles === 0 && state.embeddedChunks === 0) {
    return t("chat.indexing.summary", { status, lastRun });
  }

  return t("chat.indexing.summaryDetailed", {
    status,
    lastRun,
    indexed: state.indexedFiles,
    chunks: state.embeddedChunks,
  });
}

export function formatIndexingStateLabel(state: IndexingState, t: Translate): string {
  if (state.status === "error") {
    return t("chat.indexing.failed");
  }

  if (state.isStale || state.status === "stale") {
    return t("chat.indexing.rebuildNeeded");
  }

  return state.status[0].toUpperCase() + state.status.slice(1);
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

export function formatIndexingProgressLabel(state: IndexingState, t: Translate): string {
  if (state.phase === "embedding" && isPositiveCount(state.chunksTotal)) {
    const chunks = t("chat.indexing.progress.chunks", {
      embedded: state.chunksEmbedded ?? 0,
      total: state.chunksTotal,
    });
    const batches =
      state.embeddingBatchesTotal && state.embeddingBatchesCompleted !== undefined
        ? ` · ${t("chat.indexing.progress.batches", {
            completed: state.embeddingBatchesCompleted,
            total: state.embeddingBatchesTotal,
          })}`
        : "";

    return t("chat.indexing.progress.embedding", {
      phase: formatPhase(state.phase, t),
      chunks,
      batches,
      currentFile: formatCurrentFile(state),
    });
  }

  return t("chat.indexing.progress.files", {
    phase: formatPhase(state.phase, t),
    scanned: state.scannedFiles,
    total: state.totalFiles,
    currentFile: formatCurrentFile(state),
  });
}

export function citationTarget(citation: Citation): CitationTarget {
  const target = citationTargetString(citation.source);
  return citation.source.kind === "web" ? { kind: "web", target } : { kind: "obsidian", target };
}

export function messageDisplayContent(message: ChatDisplayMessage): string {
  if (message.role === "user") {
    return message.content;
  }

  return stripRenderedCitationIds(messageMarkdownContent(message)).trim();
}

function formatDate(value: string, locale: LocaleCode): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPhase(phase: IndexingState["phase"], t: Translate): string {
  switch (phase) {
    case "scanning":
      return t("chat.indexing.phase.scanning");
    case "checking":
      return t("chat.indexing.phase.checking");
    case "extracting":
      return t("chat.indexing.phase.extracting");
    case "chunking":
      return t("chat.indexing.phase.chunking");
    case "embedding":
      return t("chat.indexing.phase.embedding");
    case "writing":
      return t("chat.indexing.phase.writing");
    case "complete":
      return t("chat.indexing.phase.complete");
    default:
      return t("chat.indexing.phase.indexing");
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
