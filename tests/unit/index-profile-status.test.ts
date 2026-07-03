import {
  resolveEnrichmentColumnStatus,
  resolveIndexColumnStatus,
  resolveIndexProfileColumnStatus,
  resolveIndexStatusBadge,
} from "@apps/obsidian/ui/settings/indexProfileStatus";
import type { EnrichmentProfileState, IndexingState } from "@adapters/indexing";

describe("index profile status in the Index column", () => {
  it("uses short labels for active indexing states and keeps detail in the tooltip", () => {
    expect(
      resolveIndexColumnStatus({
        state: indexingState({
          status: "indexing",
          progress: 0.42,
          scannedFiles: 12,
          totalFiles: 30,
          currentFile: "Research/Long Paper.md",
        }),
      }),
    ).toEqual({
      kind: "is-indexing",
      label: "Indexing",
      tooltip: "Indexing · 42% · 12/30 files · Long Paper.md",
      animated: true,
    });

    expect(
      resolveIndexColumnStatus({
        state: indexingState({
          status: "paused",
          chunksEmbedded: 8,
          chunksTotal: 20,
        }),
      }),
    ).toMatchObject({
      kind: "is-paused",
      label: "Paused",
      tooltip: "Paused · 8/20 chunks",
    });
  });

  it("shows a finished badge with final indexing statistics in the tooltip", () => {
    expect(
      resolveIndexColumnStatus({
        state: indexingState({
          status: "idle",
          phase: "complete",
          scannedFiles: 4,
          totalFiles: 4,
          indexedFiles: 2,
          skippedFiles: 1,
          deferredFiles: 1,
          failedFiles: 0,
          embeddedChunks: 42,
          lastIndexedAt: "2026-07-03T10:20:30.000Z",
        }),
      }),
    ).toEqual({
      kind: "is-finished",
      label: "Finished",
      tooltip:
        "Finished\nFiles: 4/4 scanned · 2 indexed · 1 skipped · 1 deferred · 0 failed\nChunks embedded: 42",
    });
  });

  it("prioritizes active enrichment over a completed indexing badge", () => {
    expect(
      resolveIndexProfileColumnStatus({
        indexing: indexingState({
          status: "idle",
          phase: "complete",
          scannedFiles: 4,
          totalFiles: 4,
          indexedFiles: 2,
          skippedFiles: 2,
          embeddedChunks: 12,
          lastIndexedAt: "2026-07-03T10:20:30.000Z",
        }),
        enrichment: enrichmentState({
          status: "running",
          processed: 1,
          total: 4,
          currentSourcePath: "Books/Fairy tail.md",
          phase: "metadata",
        }),
      }),
    ).toEqual({
      kind: "is-enriching",
      label: "Enriching",
      tooltip: "Enriching metadata · 1/4 · Fairy tail.md\nextracting metadata",
      animated: true,
    });
  });

  it("does not show stale metadata while metadata enrichment is running", () => {
    const profile = {
      lastIndexedAt: "2026-07-03T10:20:30.000Z",
      lastEnrichedAt: "2026-07-03T09:00:00.000Z",
    };

    expect(
      resolveIndexStatusBadge({
        isDefault: false,
        profile,
        indexing: indexingState(),
        enrichment: enrichmentState({ status: "running", phase: "sections" }),
      }),
    ).toBeNull();

    expect(
      resolveIndexStatusBadge({
        isDefault: false,
        profile,
        indexing: indexingState(),
        enrichment: enrichmentState({ status: "done" }),
      }),
    ).toMatchObject({
      kind: "is-suspended",
      label: "Stale metadata",
    });
  });

  it("shows pending pause and metadata stop actions until the underlying run settles", () => {
    expect(
      resolveIndexColumnStatus({
        state: indexingState({
          status: "paused",
          activeOperation: "indexing",
          scannedFiles: 12,
          totalFiles: 30,
          progress: 0.42,
        }),
        pendingAction: "pausing",
      }),
    ).toMatchObject({
      kind: "is-pausing",
      label: "Pausing",
      tooltip: "Pausing · 42% · 12/30 files",
      animated: true,
    });

    expect(
      resolveEnrichmentColumnStatus({
        state: enrichmentState({
          status: "running",
          processed: 3,
          total: 8,
          currentSourcePath: "Research/Long Paper.md",
          phase: "sections",
          sectionIndex: 2,
          sectionCount: 5,
        }),
        pendingAction: "stopping",
      }),
    ).toMatchObject({
      kind: "is-stopping",
      label: "Stopping",
      tooltip: "Stopping metadata extraction · 3/8 · Long Paper.md\nsummarizing section 2/5",
      animated: true,
    });
  });
});

function indexingState(overrides: Partial<IndexingState> = {}): IndexingState {
  return {
    status: "idle",
    scannedFiles: 0,
    totalFiles: 0,
    progress: 0,
    indexedFiles: 0,
    skippedFiles: 0,
    embeddedChunks: 0,
    deferredFiles: 0,
    failedFiles: 0,
    isStale: false,
    ...overrides,
  };
}

function enrichmentState(overrides: Partial<EnrichmentProfileState> = {}): EnrichmentProfileState {
  return {
    status: "idle",
    processed: 0,
    total: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    ...overrides,
  };
}
