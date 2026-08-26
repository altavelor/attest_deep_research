import type { EnrichmentProfileState, IndexingState } from "@adapters/indexing";
import { requiresIndexRebuildForImages } from "@adapters/indexing";
import type { Translate } from "@adapters/i18n";

export interface IndexColumnStatus {
  kind: "is-indexing" | "is-paused" | "is-pausing" | "is-finished" | "is-enriching" | "is-stopping";
  label: string;
  tooltip: string;
  animated?: boolean;
}

export interface IndexStatusBadge {
  kind: "is-suspended" | "is-stale" | "is-reindex-required";
  label: string;
  title: string;
}

export type IndexPendingAction = "pausing";
export type EnrichmentPendingAction = "stopping";

export function resolveIndexProfileColumnStatus(options: {
  t: Translate;
  indexing: IndexingState;
  enrichment: EnrichmentProfileState;
  pendingIndexAction?: IndexPendingAction;
  pendingEnrichmentAction?: EnrichmentPendingAction;
}): IndexColumnStatus | null {
  return (
    resolveEnrichmentColumnStatus({
      t: options.t,
      state: options.enrichment,
      pendingAction: options.pendingEnrichmentAction,
    }) ??
    resolveIndexColumnStatus({
      t: options.t,
      state: options.indexing,
      pendingAction: options.pendingIndexAction,
    })
  );
}

export function resolveIndexStatusBadge(options: {
  t: Translate;
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
  const { t, profile, indexing, enrichment, pendingEnrichmentAction } = options;
  if (profile.isSuspended) {
    return {
      kind: "is-suspended",
      label: t("settings.status.suspended"),
      title: profile.suspendedReason ?? t("settings.status.suspended"),
    };
  }

  if (indexing.status === "error") {
    return {
      kind: "is-suspended",
      label: t("settings.indexStatus.error.label"),
      title: indexing.errorMessage ?? t("settings.indexStatus.error.title"),
    };
  }

  if (indexing.isStale || indexing.status === "stale") {
    return {
      kind: "is-stale",
      label: t("settings.indexStatus.stale.label"),
      title: t("settings.indexStatus.stale.title"),
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
      kind: "is-stale",
      label: t("settings.indexStatus.staleMetadata.label"),
      title: t("settings.indexStatus.staleMetadata.title"),
    };
  }

  if (requiresIndexRebuildForImages(profile)) {
    return {
      kind: "is-reindex-required",
      label: t("settings.indexStatus.reindexRequired.label"),
      title: t("settings.indexStatus.reindexRequired.title"),
    };
  }

  return null;
}

export function resolveIndexColumnStatus(options: {
  t: Translate;
  state: IndexingState;
  pendingAction?: IndexPendingAction;
}): IndexColumnStatus | null {
  const { t, state, pendingAction } = options;
  if (pendingAction === "pausing") {
    return {
      kind: "is-pausing",
      label: t("settings.indexStatus.pausing.label"),
      tooltip: t("settings.indexStatus.pausing.tooltip", {
        detail: formatIndexProgressDetail(t, state),
      }),
      animated: true,
    };
  }

  if (state.status === "indexing") {
    return {
      kind: "is-indexing",
      label: t("settings.indexStatus.indexing.label"),
      tooltip: t("settings.indexStatus.indexing.tooltip", {
        detail: formatIndexProgressDetail(t, state),
      }),
      animated: true,
    };
  }

  if (state.status === "paused") {
    return {
      kind: "is-paused",
      label: t("settings.indexStatus.paused.label"),
      tooltip: t("settings.indexStatus.paused.tooltip", {
        detail: formatIndexProgressDetail(t, state),
      }),
    };
  }

  if (state.phase === "complete" && state.lastIndexedAt) {
    return {
      kind: "is-finished",
      label: t("settings.indexStatus.finished.label"),
      tooltip: formatFinishedIndexTooltip(t, state),
    };
  }

  return null;
}

export function resolveEnrichmentColumnStatus(options: {
  t: Translate;
  state: EnrichmentProfileState;
  pendingAction?: EnrichmentPendingAction;
}): IndexColumnStatus | null {
  const { t, state, pendingAction } = options;
  if (pendingAction === "stopping") {
    return {
      kind: "is-stopping",
      label: t("settings.indexStatus.stopping.label"),
      tooltip: t("settings.indexStatus.stopping.tooltip", {
        detail: formatEnrichmentProgressDetail(t, state),
      }),
      animated: true,
    };
  }

  if (state.status === "running") {
    return {
      kind: "is-enriching",
      label: t("settings.indexStatus.enriching.label"),
      tooltip: t("settings.indexStatus.enriching.tooltip", {
        detail: formatEnrichmentProgressDetail(t, state),
      }),
      animated: true,
    };
  }

  return null;
}

function formatIndexProgressDetail(t: Translate, state: IndexingState): string {
  const file = state.currentFile
    ? t("settings.indexStatus.progress.file", { file: baseName(state.currentFile) })
    : "";
  if (state.chunksTotal !== undefined && state.chunksTotal > 0) {
    return t("settings.indexStatus.progress.chunks", {
      embedded: state.chunksEmbedded ?? 0,
      total: state.chunksTotal,
      file,
    });
  }

  return t("settings.indexStatus.progress.files", {
    percent: Math.round(state.progress * 100),
    scanned: state.scannedFiles,
    total: state.totalFiles,
    file,
  });
}

function formatFinishedIndexTooltip(t: Translate, state: IndexingState): string {
  const scanned =
    state.totalFiles > 0
      ? t("settings.indexStatus.finished.scanned", {
          scanned: state.scannedFiles,
          total: state.totalFiles,
        })
      : t("settings.indexStatus.finished.scanComplete");
  const counters = [
    t("settings.indexStatus.finished.indexed", { count: state.indexedFiles }),
    t("settings.indexStatus.finished.skipped", { count: state.skippedFiles }),
    t("settings.indexStatus.finished.deferred", { count: state.deferredFiles }),
    t("settings.indexStatus.finished.failed", { count: state.failedFiles }),
  ];
  return t("settings.indexStatus.finished.tooltip", {
    scanned,
    counters: counters.join(" · "),
    chunks: state.embeddedChunks,
  });
}

function formatEnrichmentProgressDetail(t: Translate, state: EnrichmentProfileState): string {
  return t("settings.indexStatus.enrichmentDetail", {
    scope:
      state.total > 0
        ? t("settings.indexStatus.enrichmentScope", {
            processed: state.processed,
            total: state.total,
          })
        : "",
    file: state.currentSourcePath
      ? t("settings.indexStatus.progress.file", { file: baseName(state.currentSourcePath) })
      : "",
    phase: enrichmentPhaseLabel(t, state),
  });
}

function enrichmentPhaseLabel(t: Translate, state: EnrichmentProfileState): string {
  switch (state.phase) {
    case "metadata":
      return t("settings.indexStatus.enrichmentPhase.metadata");
    case "sections":
      return state.sectionCount
        ? t("settings.indexStatus.enrichmentPhase.sectionsWithCount", {
            index: state.sectionIndex ?? 0,
            count: state.sectionCount,
          })
        : t("settings.indexStatus.enrichmentPhase.sections");
    case "document":
      return t("settings.indexStatus.enrichmentPhase.document");
    default:
      return state.total === 0 ? t("settings.indexStatus.enrichmentPhase.listingSources") : "";
  }
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}
