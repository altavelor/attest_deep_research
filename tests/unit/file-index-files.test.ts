import {
  atomicWriteIndexFiles,
  readBinaryIndexFile,
  readJsonIndexFile,
  readJsonlIndexFile,
  readFirstJsonlIndexRows,
} from "@adapters/indexing";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

describe("file index files", () => {
  const folder = ".attest/index";
  let fileSystem: MemoryFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryFileSystem();
  });

  it("returns fallbacks for missing JSON, JSONL, and binary files", async () => {
    await expect(
      readJsonIndexFile(fileSystem, `${folder}/missing.json`, isOkObject, { ok: true }),
    ).resolves.toEqual({ ok: true });
    await expect(
      readJsonlIndexFile(fileSystem, `${folder}/missing.jsonl`, isAnyRecord),
    ).resolves.toEqual([]);
    await expect(readBinaryIndexFile(fileSystem, `${folder}/missing.bin`)).resolves.toEqual(
      new Uint8Array(),
    );
  });

  it("rejects corrupt JSON and JSONL as rebuild-needed", async () => {
    await atomicWriteIndexFiles(fileSystem, {
      files: [
        { path: `${folder}/bad.json`, data: "{not-json" },
        { path: `${folder}/bad.jsonl`, data: '{"ok":true}\nnot-json\n' },
      ],
      manifest: { path: `${folder}/manifest.json`, data: '{"ok":true}' },
      writeId: "bad",
    });

    await expect(
      readJsonIndexFile(fileSystem, `${folder}/bad.json`, isAnyRecord, {}),
    ).rejects.toMatchObject({ code: "INDEX_REBUILD_REQUIRED" });
    await expect(
      readJsonlIndexFile(fileSystem, `${folder}/bad.jsonl`, isAnyRecord),
    ).rejects.toMatchObject({
      code: "INDEX_REBUILD_REQUIRED",
    });
  });

  it("reads a bounded JSONL prefix without loading the remaining rows", async () => {
    const path = `${folder}/rows.jsonl`;
    await atomicWriteIndexFiles(fileSystem, {
      files: [{ path, data: '{"id":1}\n{"id":2}\nnot-json\n' }],
      manifest: { path: `${folder}/manifest.json`, data: '{"ok":true}' },
      writeId: "bounded",
    });

    await expect(readFirstJsonlIndexRows(fileSystem, path, isAnyRecord, 2)).resolves.toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    await expect(
      readFirstJsonlIndexRows(fileSystem, `${folder}/missing.jsonl`, isAnyRecord, 2),
    ).resolves.toEqual([]);
  });

  it("commits all files and publishes the manifest last without leaving temp files", async () => {
    await atomicWriteIndexFiles(fileSystem, {
      files: [
        { path: `${folder}/sources.jsonl`, data: '{"sourcePath":"a.md"}\n' },
        { path: `${folder}/shards/00.chunks.jsonl`, data: '{"id":"chunk"}\n' },
        { path: `${folder}/shards/00.vectors.bin`, data: new Uint8Array([1, 2, 3, 4]) },
      ],
      manifest: { path: `${folder}/manifest.json`, data: '{"schemaVersion":1}' },
      writeId: "commit",
    });

    await expect(fileSystem.readText(`${folder}/manifest.json`)).resolves.toBe(
      '{"schemaVersion":1}',
    );
    await expect(fileSystem.readText(`${folder}/sources.jsonl`)).resolves.toBe(
      '{"sourcePath":"a.md"}\n',
    );
    await expect(fileSystem.exists(`${folder}/shards/00.vectors.bin`)).resolves.toBe(true);
    await expect(fileSystem.exists(`${folder}/manifest.json.commit.tmp`)).resolves.toBe(false);
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
