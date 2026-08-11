import {
  INDEX_DESCRIPTION_MAX_CHARACTERS,
  buildIndexDescription,
  buildMinimalIndexDescription,
  refreshIndexDescriptionAfterRun,
  resolveIndexDescriptionForPrompt,
} from "@adapters/indexing";
import { createIndexProfile } from "@adapters/settings";
import type { IndexDescriptionSource } from "@adapters/indexing";

const wholeVaultProfile = createIndexProfile({
  id: "default",
  name: "  Whole\nvault  <index>  ",
  mode: "wholeVault",
  indexFolder: ".attest/default",
  includeFolders: [],
  excludeGlobs: [],
});

const selectedProfile = createIndexProfile({
  id: "research",
  name: "Research library",
  mode: "selected",
  indexFolder: ".attest/research",
  includeFolders: [],
  excludeGlobs: ["Archive/**"],
});

function emptySource(overrides: Partial<IndexDescriptionSource> = {}): IndexDescriptionSource {
  return {
    indexUpdatedAt: "2026-06-20T10:00:00.000Z",
    sourceCount: 0,
    chunkCount: 0,
    sourceKinds: [],
    languageInventory: [],
    representativeChunks: [],
    ...overrides,
  };
}

describe("index descriptions built from incomplete metadata", () => {
  it("describes an empty index without inventing sources, kinds or languages", () => {
    const description = buildIndexDescription(
      wholeVaultProfile,
      emptySource(),
      "2026-06-20T10:01:00.000Z",
    );

    expect(description.text).toContain("covers the whole vault");
    expect(description.text).toContain("Exclusions: none.");
    expect(description.text).toContain("Source types: unknown.");
    expect(description.text).toContain("Languages: unknown.");
    expect(description.text).toContain("Representative sources: none available.");
    expect(description.text).not.toMatch(/Representative topics/);
    expect(description.diagnostics).toMatchObject({
      representativeChunkCount: 0,
      truncated: false,
      usedFallback: false,
    });
  });

  it("neutralizes angle brackets and collapsed whitespace in profile metadata", () => {
    const description = buildIndexDescription(
      wholeVaultProfile,
      emptySource(),
      "2026-06-20T10:01:00.000Z",
    );

    expect(description.text).toContain('Index "Whole vault ‹index›"');
    expect(description.text).not.toContain("<index>");
  });

  it("reports no selected folders when the selected profile includes none", () => {
    const description = buildIndexDescription(
      selectedProfile,
      emptySource(),
      "2026-06-20T10:01:00.000Z",
    );

    expect(description.text).toContain("selected folders (none)");
    expect(description.text).toContain("Exclusions: Archive/**.");
  });

  it("prefers document one-liners over representative samples", () => {
    const description = buildIndexDescription(
      selectedProfile,
      emptySource({
        sourceCount: 1,
        chunkCount: 1,
        representativeChunks: [
          {
            path: "Research/a.md",
            title: "A",
            headingPath: ["Intro"],
            text: "Sample text",
            kind: "markdown",
          },
        ],
        documentOneLiners: Array.from({ length: 60 }, (_, index) => ({
          path: `Research/doc${index}.md`,
          oneLiner: `Summary ${index}`,
        })),
      }),
      "2026-06-20T10:01:00.000Z",
    );

    expect(description.text).toContain("Documents:");
    expect(description.text).not.toContain("Representative sources:");
    expect(description.text).toContain("Research/doc49.md");
    expect(description.text).not.toContain("Research/doc50.md");
  });

  it("truncates an oversized description and records the truncation", () => {
    const description = buildIndexDescription(
      selectedProfile,
      emptySource({
        documentOneLiners: Array.from({ length: 50 }, (_, index) => ({
          path: `Research/doc${index}.md`,
          oneLiner: "x".repeat(400),
        })),
      }),
      "2026-06-20T10:01:00.000Z",
    );

    expect(description.text.length).toBe(INDEX_DESCRIPTION_MAX_CHARACTERS);
    expect(description.text.endsWith("…")).toBe(true);
    expect(description.diagnostics.truncated).toBe(true);
  });

  it("keeps at most twelve representative samples in a stable order", () => {
    const description = buildIndexDescription(
      selectedProfile,
      emptySource({
        representativeChunks: Array.from({ length: 20 }, (_, index) => ({
          path: `Research/doc${String(19 - index).padStart(2, "0")}.md`,
          title: "Title",
          headingPath: [],
          text: "shared vocabulary vocabulary",
          kind: "markdown" as const,
        })),
      }),
      "2026-06-20T10:01:00.000Z",
    );

    expect(description.diagnostics.representativeChunkCount).toBe(12);
    expect(description.text).toContain("Research/doc00.md");
    expect(description.text).not.toContain("Research/doc12.md");
    expect(description.text).toContain("Representative topics: vocabulary");
  });
});

describe("index description prompt fallback for missing metadata", () => {
  it("falls back to profile counters when no description was ever persisted", () => {
    const resolved = resolveIndexDescriptionForPrompt({
      ...selectedProfile,
      lastIndexedAt: "2026-06-20T10:00:00.000Z",
      indexedFileCount: 3,
    });

    expect(resolved.diagnostics).toMatchObject({ freshness: "missing", usedFallback: true });
    expect(resolved.text).toContain("3 sources and 0 chunks");
    expect(resolved.diagnostics.indexUpdatedAt).toBe("2026-06-20T10:00:00.000Z");
    expect(resolved.diagnostics.failureReason).toBeUndefined();
  });

  it("falls back to the profile update timestamp when the index was never built", () => {
    const resolved = resolveIndexDescriptionForPrompt({
      ...selectedProfile,
      lastIndexedAt: undefined,
      indexedFileCount: undefined,
      updatedAt: "2026-06-01T00:00:00.000Z",
    });

    expect(resolved.diagnostics.generatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(resolved.diagnostics.indexUpdatedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(resolved.text).toContain("0 sources and 0 chunks");
  });

  it("keeps a persisted failed description and surfaces its failure reason", () => {
    const failed = buildMinimalIndexDescription(selectedProfile, {
      generatedAt: "2026-06-20T10:01:00.000Z",
      indexUpdatedAt: "2026-06-20T10:00:00.000Z",
      sourceCount: 5,
      chunkCount: 9,
      failureReason: "description-generation-failed",
    });

    const resolved = resolveIndexDescriptionForPrompt({
      ...selectedProfile,
      indexDescription: failed,
    });

    expect(resolved.diagnostics).toMatchObject({
      freshness: "failed",
      usedFallback: true,
      failureReason: "description-generation-failed",
    });
    expect(resolved.text).toBe(failed.text);
  });

  it("reuses a current persisted description without rebuilding it", () => {
    const current = buildIndexDescription(
      selectedProfile,
      emptySource({ sourceCount: 5, chunkCount: 9 }),
      "2026-06-20T10:01:00.000Z",
    );

    const resolved = resolveIndexDescriptionForPrompt({
      ...selectedProfile,
      indexDescription: current,
      indexedFileCount: 99,
    });

    expect(resolved.text).toBe(current.text);
    expect(resolved.diagnostics).toMatchObject({ freshness: "current", usedFallback: false });
  });
});

describe("refreshing an index description after a run", () => {
  it("regenerates after a changed run even when a description exists", async () => {
    const existing = buildMinimalIndexDescription(selectedProfile, {
      generatedAt: "2026-06-19T10:00:00.000Z",
      indexUpdatedAt: "2026-06-19T09:00:00.000Z",
      sourceCount: 1,
      chunkCount: 2,
    });

    const refreshed = await refreshIndexDescriptionAfterRun(
      { ...selectedProfile, indexDescription: existing },
      { indexChanged: true, lastIndexedAt: "2026-06-20T11:00:00.000Z" },
      async () => emptySource({ sourceCount: 4, chunkCount: 12 }),
      "2026-06-20T11:01:00.000Z",
    );

    expect(refreshed.status).toBe("current");
    expect(refreshed.sourceCount).toBe(4);
    expect(refreshed.diagnostics.usedFallback).toBe(false);
  });

  it("generates a description when a no-change run finds none persisted", async () => {
    const loadSource = vi.fn(async () => emptySource({ sourceCount: 2, chunkCount: 5 }));

    const refreshed = await refreshIndexDescriptionAfterRun(
      selectedProfile,
      { indexChanged: false },
      loadSource,
      "2026-06-20T11:01:00.000Z",
    );

    expect(loadSource).toHaveBeenCalledTimes(1);
    expect(refreshed.sourceCount).toBe(2);
  });

  it("preserves the previously persisted counts when regeneration fails", async () => {
    const existing = buildMinimalIndexDescription(selectedProfile, {
      generatedAt: "2026-06-19T10:00:00.000Z",
      indexUpdatedAt: "2026-06-19T09:00:00.000Z",
      sourceCount: 8,
      chunkCount: 30,
    });

    const refreshed = await refreshIndexDescriptionAfterRun(
      { ...selectedProfile, indexDescription: existing, indexedFileCount: 1 },
      { indexChanged: true },
      async () => {
        throw new Error("shard read failed");
      },
      "2026-06-20T11:01:00.000Z",
    );

    expect(refreshed).toMatchObject({
      status: "failed",
      sourceCount: 8,
      chunkCount: 30,
      indexUpdatedAt: "2026-06-20T11:01:00.000Z",
    });
    expect(refreshed.diagnostics.failureReason).toBe("description-generation-failed");
  });
});
