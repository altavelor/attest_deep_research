import type { EnrichmentProfileState, IndexingState } from "@adapters/indexing";
import { requiresIndexRebuildForImages } from "@adapters/indexing";

export interface IndexColumnStatus {
  kind: "is-indexing" | "is-paused" | "is-pausing" | "is-finished" | "is-enriching" | "is-stopping";
  label: string;
  tooltip: string;
  animated?: boolean;
}

export interface IndexStatusBadge {
  kind: "is-suspended" | "is-reindex-required";
  label: string;
  title: string;
}

export type IndexPendingAction = "pausing";
export type EnrichmentPendingAction = "stopping";

export function resolveIndexProfileColumnStatus(options: {
  indexing: IndexingState;
  enrichment: EnrichmentProfileState;
  pendingIndexAction?: IndexPendingAction;
  pendingEnrichmentAction?: EnrichmentPendingAction;
}): IndexColumnStatus | null {
  return (
    resolveEnrichmentColumnStatus({
      state: options.enrichment,
      pendingAction: options.pendingEnrichmentAction,
    }) ??
    resolveIndexColumnStatus({
      state: options.indexing,
      pendingAction: options.pendingIndexAction,
    })
  );
}

export function resolveIndexStatusBadge(options: {
  profile: {
    isSuspended?: boolean;
    suspendedReason?: string;
    lastIndexedAt?: string;
    lastEnrichedAt?: string;
    indexVersion?: number;
  };
  indexing: Pick<IndexingState, "status" | "isStale" | "errorMessage">;
  enrichment: Pick<EnrichmentProfileState, "status">;
  pendingEnrichmentAction?: EnrichmentPendingAction;
}): IndexStatusBadge | null {
  const { profile, indexing, enrichment, pendingEnrichmentAction } = options;
  if (profile.isSuspended) {
    return {
      kind: "is-suspended",
      label: "Suspended",
      title: profile.suspendedReason ?? "Suspended",
    };
  }

  if (indexing.status === "error") {
    return {
      kind: "is-suspended",
      label: "Error",
      title: indexing.errorMessage ?? "Indexing failed",
    };
  }

  if (indexing.isStale || indexing.status === "stale") {
    return {
      kind: "is-suspended",
      label: "Stale index",
      title: "The index profile changed — run Update to refresh the index.",
    };
  }

  const metadataStale =
    Boolean(profile.lastEnrichedAt) &&
    Boolean(profile.lastIndexedAt) &&
    profile.lastIndexedAt! > profile.lastEnrichedAt!;
  const metadataUpdating =
    enrichment.status === "running" || pendingEnrichmentAction === "stopping";
  if (metadataStale && !metadataUpdating) {
    return {
      kind: "is-suspended",
      label: "Stale metadata",
      title:
        "The index changed after the last metadata extraction — run Update with the metadata section enabled.",
    };
  }

  if (requiresIndexRebuildForImages(profile)) {
    return {
      kind: "is-reindex-required",
      label: "Reindex required",
      title:
        "This index was built before document-image metadata existed — run a full rebuild to enable index-based image discovery. Text search keeps working.",
    };
  }

  return null;
}

export function resolveIndexColumnStatus(options: {
  state: IndexingState;
  pendingAction?: IndexPendingAction;
}): IndexColumnStatus | null {
  const { state, pendingAction } = options;
  if (pendingAction === "pausing") {
    return {
      kind: "is-pausing",
      label: "Pausing",
      tooltip: `Pausing${formatIndexProgressDetail(state)}`,
      animated: true,
    };
  }

  if (state.status === "indexing") {
    return {
      kind: "is-indexing",
      label: "Indexing",
      tooltip: `Indexing${formatIndexProgressDetail(state)}`,
      animated: true,
    };
  }

  if (state.status === "paused") {
    return {
      kind: "is-paused",
      label: "Paused",
      tooltip: `Paused${formatIndexProgressDetail(state)}`,
    };
  }

  if (state.phase === "complete" && state.lastIndexedAt) {
    return {
      kind: "is-finished",
      label: "Finished",
      tooltip: formatFinishedIndexTooltip(state),
    };
  }

  return null;
}

export function resolveEnrichmentColumnStatus(options: {
  state: EnrichmentProfileState;
  pendingAction?: EnrichmentPendingAction;
}): IndexColumnStatus | null {
  const { state, pendingAction } = options;
  if (pendingAction === "stopping") {
    return {
      kind: "is-stopping",
      label: "Stopping",
      tooltip: `Stopping metadata extraction${formatEnrichmentProgressDetail(state)}`,
      animated: true,
    };
  }

  if (state.status === "running") {
    return {
      kind: "is-enriching",
      label: "Enriching",
      tooltip: `Enriching metadata${formatEnrichmentProgressDetail(state)}`,
      animated: true,
    };
  }

  return null;
}

function formatIndexProgressDetail(state: IndexingState): string {
  const file = state.currentFile ? ` · ${baseName(state.currentFile)}` : "";
  if (state.chunksTotal !== undefined && state.chunksTotal > 0) {
    return ` · ${state.chunksEmbedded ?? 0}/${state.chunksTotal} chunks${file}`;
  }

  return ` · ${Math.round(state.progress * 100)}% · ${state.scannedFiles}/${state.totalFiles} files${file}`;
}

function formatFinishedIndexTooltip(state: IndexingState): string {
  const scanned =
    state.totalFiles > 0 ? `${state.scannedFiles}/${state.totalFiles} scanned` : "scan complete";
  const parts = [
    `${state.indexedFiles} indexed`,
    `${state.skippedFiles} skipped`,
    `${state.deferredFiles} deferred`,
    `${state.failedFiles} failed`,
  ];
  return `Finished\nFiles: ${scanned} · ${parts.join(" · ")}\nChunks embedded: ${state.embeddedChunks}`;
}

function formatEnrichmentProgressDetail(state: EnrichmentProfileState): string {
  const scope = state.total > 0 ? ` · ${state.processed}/${state.total}` : "";
  const file = state.currentSourcePath ? ` · ${baseName(state.currentSourcePath)}` : "";
  return `${scope}${file}${enrichmentPhaseLabel(state)}`;
}

function enrichmentPhaseLabel(state: EnrichmentProfileState): string {
  switch (state.phase) {
    case "metadata":
      return "\nextracting metadata";
    case "sections":
      return state.sectionCount
        ? `\nsummarizing section ${state.sectionIndex ?? 0}/${state.sectionCount}`
        : "\nsummarizing sections";
    case "document":
      return "\nwriting document summary";
    default:
      return state.total === 0 ? "\nlisting sources" : "";
  }
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}
