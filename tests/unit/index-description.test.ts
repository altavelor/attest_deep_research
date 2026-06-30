import {
  INDEX_DESCRIPTION_MAX_CHARACTERS,
  buildIndexDescription,
  buildMinimalIndexDescription,
  resolveIndexDescriptionForPrompt,
  refreshIndexDescriptionAfterRun,
} from "../../src/adapters/indexing/IndexDescription";
import { createIndexProfile } from "../../src/adapters/settings/defaults";

const profile = createIndexProfile({
  id: "research",
  name: "Research library",
  mode: "selected",
  indexFolder: ".ixplorer/research",
  includeFolders: ["Research", "Books"],
  excludeGlobs: ["Archive/**"],
});

describe("index descriptions", () => {
  it("builds a deterministic bounded description from committed index metadata", () => {
    const source = {
      indexUpdatedAt: "2026-06-20T10:00:00.000Z",
      sourceCount: 2,
      chunkCount: 3,
      sourceKinds: ["markdown", "pdf"] as const,
      languageInventory: [
        { language: "en", chunkCount: 2, sourceCount: 1 },
        { language: "ru", chunkCount: 1, sourceCount: 1 },
      ],
      representativeChunks: [
        {
          path: "Research/agents.md",
          title: "Agent systems",
          headingPath: ["Tool loops"],
          text: "Reasoning models can iteratively select tools and refine evidence.",
          kind: "markdown" as const,
        },
        {
          path: "Books/retrieval.pdf",
          title: "Retrieval handbook",
          headingPath: [],
          text: "Hybrid retrieval combines semantic and keyword evidence.",
          kind: "pdf" as const,
        },
      ],
    };

    const first = buildIndexDescription(profile, source, "2026-06-20T10:01:00.000Z");
    const second = buildIndexDescription(profile, source, "2026-06-20T10:01:00.000Z");

    expect(first).toEqual(second);
    expect(first.status).toBe("current");
    expect(first.indexUpdatedAt).toBe(source.indexUpdatedAt);
    expect(first.sourceCount).toBe(2);
    expect(first.chunkCount).toBe(3);
    expect(first.text).toContain("Research library");
    expect(first.text).toContain("Research/agents.md > Tool loops");
    expect(first.text).toContain("markdown, pdf");
    expect(first.text).not.toContain("iteratively select tools");
    expect(first.text.length).toBeLessThanOrEqual(INDEX_DESCRIPTION_MAX_CHARACTERS);
    expect(first.diagnostics).toMatchObject({
      representativeChunkCount: 2,
      usedFallback: false,
      truncated: false,
    });
  });

  it("creates a minimal failed description without samples", () => {
    const description = buildMinimalIndexDescription(profile, {
      generatedAt: "2026-06-20T10:01:00.000Z",
      indexUpdatedAt: "2026-06-20T10:00:00.000Z",
      sourceCount: 7,
      chunkCount: 21,
      failureReason: "sample-read-failed",
    });

    expect(description.status).toBe("failed");
    expect(description.text).toContain("Research, Books");
    expect(description.text).toContain("7 sources and 21 chunks");
    expect(description.diagnostics).toMatchObject({
      representativeChunkCount: 0,
      usedFallback: true,
      failureReason: "sample-read-failed",
    });
  });

  it("uses a deterministic minimal prompt fallback for stale metadata", () => {
    const staleProfile = {
      ...profile,
      lastIndexedAt: "2026-06-20T10:00:00.000Z",
      indexedFileCount: 7,
      indexDescription: {
        ...buildMinimalIndexDescription(profile, {
          generatedAt: "2026-06-19T10:00:00.000Z",
          indexUpdatedAt: "2026-06-19T09:00:00.000Z",
          sourceCount: 6,
          chunkCount: 18,
        }),
        status: "stale" as const,
      },
    };

    const resolved = resolveIndexDescriptionForPrompt(staleProfile);

    expect(resolved.text).toContain("7 sources");
    expect(resolved.diagnostics).toMatchObject({
      freshness: "stale",
      usedFallback: true,
      algorithmVersion: 1,
    });
    expect(resolved.diagnostics.textHash).toMatch(/^[a-f0-9]+$/);
  });

  it("does not regenerate or sample after a no-change run", async () => {
    const current = buildMinimalIndexDescription(profile, {
      generatedAt: "2026-06-20T10:01:00.000Z",
      indexUpdatedAt: "2026-06-20T10:00:00.000Z",
      sourceCount: 7,
      chunkCount: 21,
    });
    const loadSource = vi.fn();

    const result = await refreshIndexDescriptionAfterRun(
      { ...profile, indexDescription: current },
      { indexChanged: false, lastIndexedAt: "2026-06-20T11:00:00.000Z" },
      loadSource,
      "2026-06-20T11:01:00.000Z",
    );

    expect(result).toBe(current);
    expect(result.generatedAt).toBe("2026-06-20T10:01:00.000Z");
    expect(loadSource).not.toHaveBeenCalled();
  });

  it("stores a failed minimal description when committed sampling fails", async () => {
    const result = await refreshIndexDescriptionAfterRun(
      { ...profile, indexedFileCount: 4 },
      { indexChanged: true, lastIndexedAt: "2026-06-20T11:00:00.000Z" },
      async () => {
        throw new Error("sensitive internal path");
      },
      "2026-06-20T11:01:00.000Z",
    );

    expect(result).toMatchObject({
      status: "failed",
      generatedAt: "2026-06-20T11:01:00.000Z",
      indexUpdatedAt: "2026-06-20T11:00:00.000Z",
      diagnostics: { failureReason: "description-generation-failed" },
    });
    expect(result.diagnostics.failureReason).not.toContain("sensitive");
  });
});
