import { describe, expect, it } from "vitest";

import {
  createFileVectorManifest,
  isFileVectorManifest,
  manifestIndexVersion,
  normalizeImageManifestEntries,
  parseImageManifest,
  REQUIRED_INDEX_VERSION,
  requiresIndexRebuildForImages,
  serializeImageManifest,
} from "@adapters/indexing";
import { createTranslator } from "@adapters/i18n";
import { legacyIndexImageNotice } from "@apps/obsidian/ui/chat/chatViewStatus";

const t = createTranslator("en").t;

const entry = {
  documentPath: "docs/report.docx",
  contentHash: "hash-1",
  format: "png" as const,
  locator: "zip:word/media/image1.png",
  alt: "Sales chart",
};

describe("image manifest format", () => {
  it("round-trips entries through JSONL", () => {
    const serialized = serializeImageManifest([entry]);
    expect(parseImageManifest(serialized)).toEqual([entry]);
  });

  it("skips corrupt or invalid lines instead of failing the read", () => {
    const content = [
      JSON.stringify(entry),
      "{not json",
      JSON.stringify({ documentPath: "a" }),
    ].join("\n");
    expect(parseImageManifest(content)).toEqual([entry]);
  });

  it("deduplicates by document and locator and rejects unsupported formats", () => {
    const normalized = normalizeImageManifestEntries([
      entry,
      entry,
      { ...entry, format: "svg" as never, locator: "zip:x.svg" },
    ]);
    expect(normalized).toEqual([entry]);
  });

  it("never persists image bytes", () => {
    const serialized = serializeImageManifest([
      { ...entry, data: new Uint8Array([1, 2, 3]) } as never,
    ]);
    expect(serialized).not.toContain("data");
  });
});

describe("index version migration state", () => {
  const manifestOptions = {
    profileId: "p1",
    embeddingModel: "m",
    embeddingDimensions: 4,
    updatedAt: "2026-08-01T00:00:00.000Z",
    writeId: "w1",
  };

  it("treats a manifest without indexVersion as version 0", () => {
    const legacy = createFileVectorManifest(manifestOptions);
    expect(legacy.indexVersion).toBeUndefined();
    expect(manifestIndexVersion(legacy)).toBe(0);
    expect(requiresIndexRebuildForImages(legacy)).toBe(true);
    expect(isFileVectorManifest(legacy)).toBe(true);
  });

  it("accepts a manifest at the required version", () => {
    const current = createFileVectorManifest({
      ...manifestOptions,
      indexVersion: REQUIRED_INDEX_VERSION,
    });
    expect(isFileVectorManifest(current)).toBe(true);
    expect(requiresIndexRebuildForImages(current)).toBe(false);
  });

  it("warns in chat for a legacy profile only", () => {
    expect(legacyIndexImageNotice({}, t)).toContain("full rebuild");
    expect(legacyIndexImageNotice({ indexVersion: REQUIRED_INDEX_VERSION }, t)).toBeNull();
    expect(legacyIndexImageNotice(undefined, t)).toBeNull();
  });
});
