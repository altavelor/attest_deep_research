import { describe, expect, it } from "vitest";

import { App, TFile } from "obsidian";

import { hashFileData } from "@adapters/indexing";
import type { CompositionContext } from "@apps/obsidian/composition/CompositionContext";
import { createDocumentImageCandidates } from "@apps/obsidian/composition/mediaFactory";
import { resolveAnswerImageSource } from "@apps/obsidian/ui/chat/artifacts/imageSourceResolver";
import type { AnswerImage } from "@core/media";
import { toAnswerImage, vaultFileFingerprint } from "@core/media";

function jpegBytes(width: number, height: number): Buffer {
  const frame = Buffer.alloc(11);
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(9, 2);
  frame.writeUInt8(8, 4);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from("ffd8", "hex"), frame, Buffer.alloc(32, 0x11)]);
}

const fb2 = `<FictionBook><body><p>text</p></body><binary id="cover.jpg" content-type="image/jpeg">${jpegBytes(
  64,
  64,
).toString("base64")}</binary></FictionBook>`;

function vaultFile(path: string, size: number, mtime: number): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  Object.assign(file, { path, stat: { size, mtime, ctime: 0 } });
  return file;
}

function vaultContext(files: Record<string, { data?: string; size?: number; mtime?: number }>) {
  const entries = new Map(
    Object.entries(files).map(([path, entry]) => [
      path,
      { file: vaultFile(path, entry.size ?? 1, entry.mtime ?? 1), data: entry.data },
    ]),
  );
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => entries.get(path)?.file,
      getResourcePath: (file: TFile) => `app://vault/${file.path}`,
      readBinary: async (file: TFile) => {
        const buffer = Buffer.from(entries.get(file.path)?.data ?? "", "utf8");
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
      },
    },
    metadataCache: {
      getFirstLinkpathDest: (target: string) => entries.get(target)?.file,
    },
  } as unknown as App;

  return {
    app,
    ctx: { app, getSettings: () => ({ webSources: [] }) } as unknown as CompositionContext,
  };
}

describe("vault image fingerprints", () => {
  it("stamps an embedded image with its document's content hash", async () => {
    const { ctx } = vaultContext({ "books/tale.fb2": { data: fb2 } });
    const candidates = await createDocumentImageCandidates(ctx)({
      query: "cover",
      contextPaths: ["books/tale.fb2"],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.vaultSource).toMatchObject({
      documentPath: "books/tale.fb2",
      locator: "binary:cover.jpg",
      contentHash: hashFileData(fb2),
    });
  });

  it("stamps a linked image file with its stat fingerprint", async () => {
    const { ctx } = vaultContext({
      "notes/topic.md": { data: "![Photo](../assets/photo.png)" },
      "assets/photo.png": { size: 2048, mtime: 1700000000000 },
    });
    const candidates = await createDocumentImageCandidates(ctx)({
      query: "photo",
      contextPaths: ["notes/topic.md"],
    });

    expect(candidates[0]!.vaultSource).toEqual({
      documentPath: "assets/photo.png",
      locator: "file",
      contentHash: vaultFileFingerprint(2048, 1700000000000),
    });
  });
});

describe("linked image verification at render time", () => {
  const image = (contentHash?: string): AnswerImage =>
    toAnswerImage({
      id: "img_1",
      origin: "document",
      format: "png",
      vaultSource: {
        documentPath: "assets/photo.png",
        locator: "file",
        ...(contentHash ? { contentHash } : {}),
      },
      alt: "Photo",
      sourceUrl: "assets/photo.png",
      sourceLabel: "photo.png",
    })!;

  it("serves the file while its fingerprint still matches", async () => {
    const { app } = vaultContext({ "assets/photo.png": { size: 2048, mtime: 1700000000000 } });
    const resolved = await resolveAnswerImageSource(
      image(vaultFileFingerprint(2048, 1700000000000)),
      { app },
      false,
    );

    expect(resolved?.src).toBe("app://vault/assets/photo.png");
  });

  it("falls back when the linked file was replaced", async () => {
    const { app } = vaultContext({ "assets/photo.png": { size: 4096, mtime: 1800000000000 } });
    const resolved = await resolveAnswerImageSource(
      image(vaultFileFingerprint(2048, 1700000000000)),
      { app },
      false,
    );

    expect(resolved).toBeUndefined();
  });

  it("still serves an artifact saved before fingerprinting existed", async () => {
    const { app } = vaultContext({ "assets/photo.png": { size: 4096, mtime: 1800000000000 } });
    const resolved = await resolveAnswerImageSource(image(), { app }, false);

    expect(resolved?.src).toBe("app://vault/assets/photo.png");
  });
});
