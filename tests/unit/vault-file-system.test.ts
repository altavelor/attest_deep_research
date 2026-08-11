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

describe("VaultFileSystem crash-safe replace", () => {
  it("keeps the previous file recoverable when the replace is interrupted", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/manifest.json", '{"generation":1}');
    await fileSystem.writeText("index/manifest.json.w1.tmp", '{"generation":2}');

    const realRename = adapter.rename.bind(adapter);
    let renameCalls = 0;
    adapter.rename = async (from: string, to: string) => {
      renameCalls += 1;
      if (renameCalls === 2) {
        throw new Error("process died mid-replace");
      }
      return realRename(from, to);
    };

    await expect(
      fileSystem.rename("index/manifest.json.w1.tmp", "index/manifest.json"),
    ).rejects.toThrow();

    adapter.rename = realRename;

    expect(await fileSystem.exists("index/manifest.json")).toBe(true);
    expect(await fileSystem.readText("index/manifest.json")).toBe('{"generation":1}');
  });

  it("recovers the previous file when the process dies before the replacement lands", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/manifest.json", '{"generation":1}');
    await adapter.rename("index/manifest.json", "index/manifest.json.ixplorer-replaced");

    expect(await fileSystem.exists("index/manifest.json")).toBe(true);
    expect(await fileSystem.readText("index/manifest.json")).toBe('{"generation":1}');
    expect(await adapter.exists("index/manifest.json.ixplorer-replaced")).toBe(false);
  });

  it("leaves no backup behind after a successful replace", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/manifest.json", "old");
    await fileSystem.writeText("index/manifest.json.tmp", "new");
    await fileSystem.rename("index/manifest.json.tmp", "index/manifest.json");

    expect(await fileSystem.readText("index/manifest.json")).toBe("new");
    expect(await adapter.exists("index/manifest.json.ixplorer-replaced")).toBe(false);
    expect(await adapter.exists("index/manifest.json.tmp")).toBe(false);
  });
});

describe("VaultFileSystem recovery via listing", () => {
  it("restores an interrupted replace that is only ever reached through list", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("chats/chat-abc.json", '{"id":"chat-abc"}');
    await adapter.rename("chats/chat-abc.json", "chats/chat-abc.json.ixplorer-replaced");

    const entries = await fileSystem.list("chats");

    expect(entries.map((entry) => entry.name)).toEqual(["chat-abc.json"]);
    expect(await fileSystem.readText("chats/chat-abc.json")).toBe('{"id":"chat-abc"}');
  });

  it("never reports backup files, so they are not counted or listed", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/a.json", "1");
    await fileSystem.writeText("index/a.json.ixplorer-replaced", "stale");

    const entries = await fileSystem.list("index");

    expect(entries.map((entry) => entry.name)).toEqual(["a.json"]);
  });
});

describe("VaultFileSystem recovery is best effort", () => {
  it("reports the original read failure when recovery itself fails", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    adapter.rename = async () => {
      throw new Error("recovery exploded");
    };
    await adapter.writeBinary(
      "index/manifest.json.ixplorer-replaced",
      new TextEncoder().encode("old").slice().buffer as ArrayBuffer,
    );

    await expect(fileSystem.readText("index/manifest.json")).rejects.toThrow(/File not found/);
  });

  it("propagates an adapter failure from exists instead of hiding it as a missing file", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    adapter.exists = async () => {
      throw new Error("adapter unavailable");
    };

    await expect(fileSystem.exists("index/manifest.json")).rejects.toThrow(/adapter unavailable/);
  });

  it("serialises concurrent replaces of the same target", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/manifest.json", "v0");
    await fileSystem.writeText("index/a.tmp", "v1");
    await fileSystem.writeText("index/b.tmp", "v2");

    await Promise.all([
      fileSystem.rename("index/a.tmp", "index/manifest.json"),
      fileSystem.rename("index/b.tmp", "index/manifest.json"),
    ]);

    expect(["v1", "v2"]).toContain(await fileSystem.readText("index/manifest.json"));
    expect(await adapter.exists("index/manifest.json.ixplorer-replaced")).toBe(false);
  });
});

describe("VaultFileSystem reads never destroy a backup", () => {
  it("keeps the backup when the original is present, so a synced pair survives listing", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/manifest.json", "current");
    await fileSystem.writeText("index/manifest.json.ixplorer-replaced", "previous");

    await fileSystem.list("index");
    await fileSystem.exists("index/manifest.json");
    await fileSystem.readText("index/manifest.json");

    expect(await adapter.exists("index/manifest.json.ixplorer-replaced")).toBe(true);
    expect(await adapter.read("index/manifest.json.ixplorer-replaced")).toBe("previous");
  });

  it("clears a stale backup on the next replace rather than on a read", async () => {
    const adapter = new MemoryDataAdapter();
    const fileSystem = new VaultFileSystem(adapter as never);

    await fileSystem.writeText("index/manifest.json", "current");
    await fileSystem.writeText("index/manifest.json.ixplorer-replaced", "stale");
    await fileSystem.writeText("index/next.tmp", "next");

    await fileSystem.rename("index/next.tmp", "index/manifest.json");

    expect(await fileSystem.readText("index/manifest.json")).toBe("next");
    expect(await adapter.exists("index/manifest.json.ixplorer-replaced")).toBe(false);
  });
});
