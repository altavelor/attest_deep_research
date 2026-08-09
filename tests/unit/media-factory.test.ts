import { describe, expect, it, vi } from "vitest";

import {
  createDocumentImageCandidates,
  createImageSearchRegistry,
} from "@apps/obsidian/composition/mediaFactory";
import type { CompositionContext } from "@apps/obsidian/composition/CompositionContext";
import type { DocumentImageManifestEntry } from "@application/ports";

function context(): CompositionContext {
  return {
    app: {
      vault: { getAbstractFileByPath: vi.fn(() => null) },
      metadataCache: { getFirstLinkpathDest: vi.fn() },
    },
    getSettings: () => ({ webSources: [] }),
  } as unknown as CompositionContext;
}

function entry(overrides: Partial<DocumentImageManifestEntry>): DocumentImageManifestEntry {
  return {
    documentPath: "Research/vision-notes.md",
    contentHash: "content-hash",
    format: "png",
    locator: "image:0",
    alt: "Vision diagram",
    ...overrides,
  };
}

describe("createDocumentImageCandidates", () => {
  it("uses relevant indexed images while rejecting unsafe documents, formats, and linked paths", async () => {
    const indexImages = {
      listDocumentImages: vi.fn(async () => [
        entry({}),
        entry({
          documentPath: "Research/other.md",
          locator: "link:Assets/chart.png",
          alt: "Vision chart",
        }),
        entry({ documentPath: "../outside.md", locator: "image:1" }),
        entry({ documentPath: "Research/unsupported.md", format: "svg", locator: "image:1" }),
        entry({ documentPath: "Research/bad-link.md", locator: "link:../secret.png" }),
      ]),
    };

    const candidates = await createDocumentImageCandidates(
      context(),
      indexImages,
    )({
      query: "vision",
      contextPaths: [],
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        id: "vault:Research/vision-notes.md#image:0",
        format: "png",
        alt: "Vision diagram",
      }),
      expect.objectContaining({
        id: "vault:Research/other.md#link:Assets/chart.png",
        vaultSource: expect.objectContaining({ documentPath: "Assets/chart.png", locator: "file" }),
      }),
    ]);
  });

  it("uses read documents even without query terms and tolerates an unavailable index manifest", async () => {
    const selected = entry({ documentPath: "Research/unrelated.md", alt: undefined });
    const discover = createDocumentImageCandidates(context(), {
      listDocumentImages: vi.fn(async () => [selected]),
    });

    await expect(
      discover({ query: "", contextPaths: [], readPaths: [selected.documentPath] }),
    ).resolves.toEqual([expect.objectContaining({ alt: "Image 1 from unrelated.md" })]);
    await expect(
      createDocumentImageCandidates(context(), {
        listDocumentImages: vi.fn(async () => {
          throw new Error("manifest unavailable");
        }),
      })({ query: "vision", contextPaths: [] }),
    ).resolves.toEqual([]);
  });

  it("returns early when a request is already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const indexImages = { listDocumentImages: vi.fn(async () => [entry({})]) };

    await expect(
      createDocumentImageCandidates(
        context(),
        indexImages,
      )({
        query: "vision",
        contextPaths: ["Research/vision-notes.md"],
        signal: controller.signal,
      }),
    ).resolves.toEqual([]);
    expect(indexImages.listDocumentImages).not.toHaveBeenCalled();
  });
});

describe("createImageSearchRegistry", () => {
  it("omits image search when every configured source is inactive", () => {
    const ctx = context();
    ctx.getSettings = () =>
      ({
        webSources: [{ sourceId: "wikimedia-commons", activation: "off", credentials: {} }],
      }) as ReturnType<CompositionContext["getSettings"]>;

    expect(createImageSearchRegistry(ctx)).toBeUndefined();
  });

  it("exposes each active image source configured for the run", () => {
    const ctx = context();
    ctx.getSettings = () =>
      ({
        webSources: [
          { sourceId: "wikimedia-commons", activation: "always", credentials: {} },
          { sourceId: "openverse", activation: "always", credentials: {} },
          {
            sourceId: "brave",
            activation: "always",
            credentials: { apiKey: "key" },
            imageSearchEnabled: true,
          },
        ],
      }) as ReturnType<CompositionContext["getSettings"]>;

    expect(
      createImageSearchRegistry(ctx)
        ?.enabledImageSources()
        .map((source) => source.descriptor.id),
    ).toEqual(["wikimedia-commons", "openverse", "brave"]);
  });
});
