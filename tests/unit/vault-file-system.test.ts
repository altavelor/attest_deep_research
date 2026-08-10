import { describe, expect, it, beforeEach } from "vitest";

import { MemoryDataAdapter } from "../stubs/obsidian";
import { VaultFileSystem } from "@adapters/obsidian/VaultFileSystem";

describe("VaultFileSystem", () => {
  let adapter: MemoryDataAdapter;
  let fileSystem: VaultFileSystem;

  beforeEach(() => {
    adapter = new MemoryDataAdapter();
    fileSystem = new VaultFileSystem(adapter as never);
  });

  it("round-trips text through the vault adapter", async () => {
    await fileSystem.writeText(".ixplorer/index/manifest.json", '{"ok":true}');

    expect(await fileSystem.readText(".ixplorer/index/manifest.json")).toBe('{"ok":true}');
  });

  it("creates missing parent folders when writing", async () => {
    await fileSystem.writeText("a/b/c/deep.json", "{}");

    expect(await fileSystem.exists("a")).toBe(true);
    expect(await fileSystem.exists("a/b")).toBe(true);
    expect(await fileSystem.exists("a/b/c")).toBe(true);
  });

  it("round-trips binary data without corrupting bytes", async () => {
    const data = new Uint8Array([0, 1, 127, 128, 255, 254]);
    await fileSystem.writeBinary("index/vectors.bin", data);

    expect(Array.from(await fileSystem.readBinary("index/vectors.bin"))).toEqual(Array.from(data));
  });

  it("writes only the bytes of a subarray view, not its backing buffer", async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9, 9]);
    await fileSystem.writeBinary("index/view.bin", backing.subarray(2, 5));

    expect(Array.from(await fileSystem.readBinary("index/view.bin"))).toEqual([1, 2, 3]);
  });

  it("normalizes backslashes and duplicate separators", async () => {
    await fileSystem.writeText("a\\\\b//c.json", "value");

    expect(await fileSystem.readText("a/b/c.json")).toBe("value");
  });

  it("reports file stats and distinguishes folders", async () => {
    await fileSystem.writeText("index/notes.json", "12345");

    const file = await fileSystem.stat("index/notes.json");
    const folder = await fileSystem.stat("index");

    expect(file?.kind).toBe("file");
    expect(file?.size).toBe(5);
    expect(folder?.kind).toBe("folder");
    expect(await fileSystem.stat("index/missing.json")).toBeNull();
  });

  it("lists files and folders with vault-relative paths and names", async () => {
    await fileSystem.writeText("index/a.json", "1");
    await fileSystem.writeText("index/nested/b.json", "2");

    const entries = (await fileSystem.list("index")).sort((left, right) =>
      left.path.localeCompare(right.path),
    );

    expect(entries).toEqual([
      { path: "index/a.json", name: "a.json", kind: "file" },
      { path: "index/nested", name: "nested", kind: "folder" },
    ]);
  });

  it("renames over an existing file instead of failing", async () => {
    await fileSystem.writeText("index/target.json", "old");
    await fileSystem.writeText("index/source.json.tmp", "new");

    await fileSystem.rename("index/source.json.tmp", "index/target.json");

    expect(await fileSystem.readText("index/target.json")).toBe("new");
    expect(await fileSystem.exists("index/source.json.tmp")).toBe(false);
  });

  it("removes a folder and everything under it", async () => {
    await fileSystem.writeText("index/a.json", "1");
    await fileSystem.writeText("index/nested/b.json", "2");

    await fileSystem.removeFolder("index", { recursive: true });

    expect(await fileSystem.exists("index")).toBe(false);
    expect(await fileSystem.exists("index/nested/b.json")).toBe(false);
  });

  it("appends to an existing file", async () => {
    await fileSystem.writeText("log.jsonl", '{"a":1}\n');
    await fileSystem.append("log.jsonl", '{"b":2}\n');

    expect(await fileSystem.readText("log.jsonl")).toBe('{"a":1}\n{"b":2}\n');
  });

  describe("readTextLines", () => {
    async function collect(path: string): Promise<string[]> {
      const lines: string[] = [];
      for await (const line of fileSystem.readTextLines(path)) {
        lines.push(line);
      }
      return lines;
    }

    it("yields each line without its terminator", async () => {
      await fileSystem.writeText("rows.jsonl", '{"a":1}\n{"b":2}\n{"c":3}\n');

      expect(await collect("rows.jsonl")).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    });

    it("yields a final line that has no trailing newline", async () => {
      await fileSystem.writeText("rows.jsonl", "first\nsecond");

      expect(await collect("rows.jsonl")).toEqual(["first", "second"]);
    });

    it("strips carriage returns from CRLF files", async () => {
      await fileSystem.writeText("rows.jsonl", "first\r\nsecond\r\n");

      expect(await collect("rows.jsonl")).toEqual(["first", "second"]);
    });

    it("yields nothing for an empty file", async () => {
      await fileSystem.writeText("rows.jsonl", "");

      expect(await collect("rows.jsonl")).toEqual([]);
    });

    it("preserves blank lines between rows", async () => {
      await fileSystem.writeText("rows.jsonl", "first\n\nsecond\n");

      expect(await collect("rows.jsonl")).toEqual(["first", "", "second"]);
    });
  });

  it("creating an existing folder is a no-op rather than an error", async () => {
    await fileSystem.createFolder("index/nested");

    await expect(fileSystem.createFolder("index/nested")).resolves.toBeUndefined();
  });

  it("rejects reads of a missing file so callers can fall back", async () => {
    await expect(fileSystem.readText("index/missing.json")).rejects.toThrow();
  });
});
