import { describe, expect, it, vi } from "vitest";

import { AnswerArtifactRegistry } from "@adapters/research-tools/media/AnswerArtifactRegistry";
import {
  ImageSearchTool,
  PresentChartTool,
  PresentImageGalleryTool,
} from "@adapters/research-tools/media/MediaTools";
import { ARTIFACT_LIMITS, type ImageCandidate } from "@core/media";
import type { ImageSearchSource } from "@application/ports";
import { findWebSourceDescriptor, WIKIMEDIA_COMMONS_SOURCE_ID } from "@core/web";

const candidate = (id: string, overrides: Partial<ImageCandidate> = {}): ImageCandidate => ({
  id,
  origin: "provider",
  fullUrl: `https://example.com/${id}.png`,
  alt: `Alt ${id}`,
  sourceUrl: `https://example.com/page/${id}`,
  sourceLabel: "Example",
  ...overrides,
});

function fakeSource(results: ImageCandidate[] | Error): ImageSearchSource {
  return {
    descriptor: findWebSourceDescriptor(WIKIMEDIA_COMMONS_SOURCE_ID)!,
    searchImages: vi.fn().mockImplementation(async () => {
      if (results instanceof Error) throw results;
      return results;
    }),
  };
}

async function run<T>(tool: { execute(input: any, context: any): Promise<T> }, input: unknown) {
  return tool.execute(input as never, {} as never);
}

describe("search_images", () => {
  it("registers candidates and returns opaque handles instead of urls", async () => {
    const artifacts = new AnswerArtifactRegistry();
    const tool = new ImageSearchTool({
      registry: { enabledImageSources: () => [fakeSource([candidate("a"), candidate("b")])] },
      artifacts,
    });
    const result = (await run(tool, { query: "cats", limit: 6 })) as any;
    expect(result.ok).toBe(true);
    expect(result.value.images.map((image: any) => image.imageId)).toEqual(["img_1", "img_2"]);
    expect(JSON.stringify(result.value.images)).not.toContain("https://example.com/a.png");
    expect(artifacts.resolve("img_1")?.id).toBe("a");
  });

  it("reports the failing provider while still returning the working one", async () => {
    const tool = new ImageSearchTool({
      registry: {
        enabledImageSources: () => [fakeSource(new Error("boom")), fakeSource([candidate("c")])],
      },
      artifacts: new AnswerArtifactRegistry(),
    });
    const result = (await run(tool, { query: "cats", limit: 6 })) as any;
    expect(result.ok).toBe(true);
    expect(result.value.diagnostics.resultCount).toBe(1);
    expect(result.value.diagnostics.failedSources).toEqual(["Wikimedia Commons"]);
  });

  it("includes candidates from documents already read in the run", async () => {
    const tool = new ImageSearchTool({
      registry: { enabledImageSources: () => [] },
      artifacts: new AnswerArtifactRegistry(),
      documentCandidates: () => [
        candidate("doc", {
          origin: "document",
          fullUrl: undefined,
          vaultSource: { documentPath: "docs/a.pdf", locator: "page:1:0" },
          sourceUrl: "docs/a.pdf",
        }),
      ],
    });
    const result = (await run(tool, { query: "figure", limit: 6 })) as any;
    expect(result.value.diagnostics.sourcesQueried).toEqual(["vault documents"]);
  });

  it("reports that no image resource is enabled instead of a bare no-match", async () => {
    const tool = new ImageSearchTool({
      registry: { enabledImageSources: () => [] },
      artifacts: new AnswerArtifactRegistry(),
    });
    const result = (await run(tool, { query: "cats", limit: 6 })) as any;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("no-image-sources");
  });

  it("distinguishes a broken provider from a genuine no-match", async () => {
    const failing = new ImageSearchTool({
      registry: { enabledImageSources: () => [fakeSource(new Error("boom"))] },
      artifacts: new AnswerArtifactRegistry(),
    });
    const failed = (await run(failing, { query: "cats", limit: 6 })) as any;
    expect(failed.error.code).toBe("image-search-failed");
    expect(failed.error.retryable).toBe(true);

    const empty = new ImageSearchTool({
      registry: { enabledImageSources: () => [fakeSource([])] },
      artifacts: new AnswerArtifactRegistry(),
    });
    const noMatch = (await run(empty, { query: "cats", limit: 6 })) as any;
    expect(noMatch.error.code).toBe("no-image-candidates");
    expect(noMatch.error.message).toMatch(/two or three concrete subject words/);
  });

  it("broadens the query when the literal one matches nothing", async () => {
    const source = fakeSource([]);
    (source.searchImages as any).mockImplementation(async (query: string) =>
      query === "солнечной системы планеты" ? [candidate("a")] : [],
    );
    const tool = new ImageSearchTool({
      registry: { enabledImageSources: () => [source] },
      artifacts: new AnswerArtifactRegistry(),
    });
    const result = (await run(tool, { query: "схема солнечной системы планеты", limit: 6 })) as any;
    expect(result.ok).toBe(true);
    expect(result.value.diagnostics.effectiveQuery).toBe("солнечной системы планеты");
  });

  it("surfaces images from pages already fetched in this run", async () => {
    const artifacts = new AnswerArtifactRegistry();
    artifacts.register([candidate("page-1", { origin: "page" })]);
    const tool = new ImageSearchTool({
      registry: { enabledImageSources: () => [fakeSource([])] },
      artifacts,
    });
    const result = (await run(tool, { query: "solar system", limit: 6 })) as any;
    expect(result.ok).toBe(true);
    expect(result.value.images).toHaveLength(1);
    expect(result.value.images[0].origin).toBe("page");
    expect(result.value.diagnostics.sourcesQueried).toContain("fetched pages");
  });
});

describe("present_image_gallery", () => {
  function toolWith(registered: ImageCandidate[]) {
    const artifacts = new AnswerArtifactRegistry();
    artifacts.register(registered);
    return { artifacts, tool: new PresentImageGalleryTool({ artifacts }) };
  }

  it("builds a gallery from run handles", async () => {
    const { artifacts, tool } = toolWith([candidate("a"), candidate("b")]);
    const parsed = tool.parseInput({ imageIds: ["img_1", "img_2"], title: "Examples" });
    expect(parsed.ok).toBe(true);
    const result = (await run(tool, (parsed as any).value)) as any;
    expect(result.ok).toBe(true);
    const snapshot = artifacts.snapshot()!;
    expect(snapshot[0]).toMatchObject({ type: "image-gallery", title: "Examples" });
    expect((snapshot[0] as any).images).toHaveLength(2);
  });

  it.each([
    [{ imageIds: [] }, "invalid-image-ids"],
    [
      { imageIds: Array.from({ length: ARTIFACT_LIMITS.galleryImages + 1 }, (_, i) => `img_${i}`) },
      "too-many-images",
    ],
    [{ imageIds: ["https://example.com/a.png"], extra: 1 }, "unknown-property"],
  ])("rejects invalid arguments (%#)", (input, code) => {
    const { tool } = toolWith([candidate("a")]);
    const parsed = tool.parseInput(input as Record<string, unknown>);
    expect(parsed.ok).toBe(false);
    expect((parsed as any).error.code).toBe(code);
  });

  it("refuses handles that were not discovered in this run", async () => {
    const { artifacts, tool } = toolWith([candidate("a")]);
    const result = (await run(tool, { imageIds: ["img_99"] })) as any;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("unknown-image-id");
    expect(artifacts.snapshot()).toBeUndefined();
  });

  it("deduplicates repeated handles", () => {
    const { tool } = toolWith([candidate("a")]);
    const parsed = tool.parseInput({ imageIds: ["img_1", "img_1"] });
    expect((parsed as any).value.imageIds).toEqual(["img_1"]);
  });
});

describe("present_chart", () => {
  it("accepts chart data and stores a chart artifact", async () => {
    const artifacts = new AnswerArtifactRegistry();
    const tool = new PresentChartTool({ artifacts });
    const parsed = tool.parseInput({
      title: "Revenue",
      chartType: "bar",
      series: [{ name: "2026", points: [{ x: "Q1", y: 4 }] }],
    });
    expect(parsed.ok).toBe(true);
    const result = (await run(tool, (parsed as any).value)) as any;
    expect(result.ok).toBe(true);
    expect(artifacts.snapshot()![0]).toMatchObject({ type: "chart", id: "chart_1" });
  });

  it("rejects model-supplied markup and unknown properties", () => {
    const tool = new PresentChartTool({ artifacts: new AnswerArtifactRegistry() });
    expect(
      (tool.parseInput({ title: "t", chartType: "bar", svg: "<svg/>", series: [] }) as any).error
        .code,
    ).toBe("unknown-property");
    expect(
      (
        tool.parseInput({
          title: "t",
          chartType: "bar",
          series: [{ name: "a", points: [{ x: "1", y: Number.POSITIVE_INFINITY }] }],
        }) as any
      ).error.code,
    ).toBe("invalid-point");
  });
});

describe("artifact registry", () => {
  it("drops candidates that cannot be rendered safely", () => {
    const artifacts = new AnswerArtifactRegistry();
    const registered = artifacts.register([
      candidate("ok"),
      candidate("bad", { fullUrl: "http://insecure.example.com/a.png" }),
    ]);
    expect(registered).toHaveLength(1);
  });

  it("reuses the handle for a repeated candidate", () => {
    const artifacts = new AnswerArtifactRegistry();
    expect(artifacts.register([candidate("a")])[0]!.handle).toBe("img_1");
    expect(artifacts.register([candidate("a")])[0]!.handle).toBe("img_1");
  });

  it("returns no snapshot when nothing was presented", () => {
    expect(new AnswerArtifactRegistry().snapshot()).toBeUndefined();
  });
});
