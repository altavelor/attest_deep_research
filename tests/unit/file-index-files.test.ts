import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  atomicWriteIndexFiles,
  readBinaryIndexFile,
  readJsonIndexFile,
  readJsonlIndexFile,
} from "../../src/indexing/fileIndexFiles";

describe("file index files", () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), "ixplorer-file-index-"));
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it("returns fallbacks for missing JSON, JSONL, and binary files", async () => {
    await expect(
      readJsonIndexFile(join(folder, "missing.json"), isOkObject, { ok: true }),
    ).resolves.toEqual({ ok: true });
    await expect(readJsonlIndexFile(join(folder, "missing.jsonl"), isAnyRecord)).resolves.toEqual(
      [],
    );
    await expect(readBinaryIndexFile(join(folder, "missing.bin"))).resolves.toEqual(
      new Uint8Array(),
    );
  });

  it("rejects corrupt JSON and JSONL as rebuild-needed", async () => {
    await atomicWriteIndexFiles({
      files: [
        { path: join(folder, "bad.json"), data: "{not-json" },
        { path: join(folder, "bad.jsonl"), data: '{"ok":true}\nnot-json\n' },
      ],
      manifest: { path: join(folder, "manifest.json"), data: '{"ok":true}' },
      writeId: "bad",
    });

    await expect(
      readJsonIndexFile(join(folder, "bad.json"), isAnyRecord, {}),
    ).rejects.toMatchObject({ code: "INDEX_REBUILD_REQUIRED" });
    await expect(readJsonlIndexFile(join(folder, "bad.jsonl"), isAnyRecord)).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
    });
  });

  it("commits all files and publishes the manifest last without leaving temp files", async () => {
    await atomicWriteIndexFiles({
      files: [
        { path: join(folder, "sources.jsonl"), data: '{"sourcePath":"a.md"}\n' },
        { path: join(folder, "shards", "00.chunks.jsonl"), data: '{"id":"chunk"}\n' },
        { path: join(folder, "shards", "00.vectors.bin"), data: new Uint8Array([1, 2, 3, 4]) },
      ],
      manifest: { path: join(folder, "manifest.json"), data: '{"schemaVersion":1}' },
      writeId: "commit",
    });

    expect(readFileSync(join(folder, "manifest.json"), "utf8")).toBe('{"schemaVersion":1}');
    expect(readFileSync(join(folder, "sources.jsonl"), "utf8")).toBe('{"sourcePath":"a.md"}\n');
    expect(existsSync(join(folder, "shards", "00.vectors.bin"))).toBe(true);
    expect(existsSync(join(folder, "manifest.json.commit.tmp"))).toBe(false);
  });
});

function isOkObject(value: unknown): value is { ok: boolean } {
  return (
    typeof value === "object" && value !== null && "ok" in value && typeof value.ok === "boolean"
  );
}

function isAnyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
