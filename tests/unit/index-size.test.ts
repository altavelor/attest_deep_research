import { formatIndexSize, measureFolderSize } from "@adapters/indexing";

import { MemoryFileSystem } from "../helpers/memoryFileSystem";

describe("index size formatting", () => {
  it("formats bytes using compact binary units", () => {
    expect(formatIndexSize(0)).toBe("0 B");
    expect(formatIndexSize(42)).toBe("42 B");
    expect(formatIndexSize(42 * 1024)).toBe("42 KB");
    expect(formatIndexSize(18.5 * 1024 * 1024)).toBe("18.5 MB");
  });

  it("degrades gracefully when size cannot be measured", () => {
    expect(formatIndexSize(null)).toBe("Unavailable");
    expect(formatIndexSize(undefined)).toBe("Unavailable");
  });

  it("sums file sizes across nested folders", async () => {
    const fileSystem = new MemoryFileSystem();
    const folder = ".ixplorer/index";
    await fileSystem.writeBinary(`${folder}/vectors.bin`, new Uint8Array(12));
    await fileSystem.writeBinary(`${folder}/shards/part-1.json`, new Uint8Array(7));

    await expect(measureFolderSize(fileSystem, folder)).resolves.toBe(19);
  });

  it("returns unavailable when the index folder cannot be read", async () => {
    const fileSystem = new MemoryFileSystem();

    await expect(measureFolderSize(fileSystem, ".ixplorer/missing")).resolves.toBeNull();
  });
});
