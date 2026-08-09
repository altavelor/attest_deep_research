import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatIndexSize, measureFolderSize } from "@adapters/indexing";

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

  it("measures nested files while ignoring directory entries that are not files", async () => {
    const folder = await mkdtemp(join(tmpdir(), "ixplorer-index-size-"));
    try {
      await writeFile(join(folder, "vectors.bin"), new Uint8Array(12));
      await mkdir(join(folder, "shards"));
      await writeFile(join(folder, "shards", "part-1.json"), new Uint8Array(7));
      await symlink(join(folder, "vectors.bin"), join(folder, "vectors-link"));

      await expect(measureFolderSize(folder)).resolves.toBe(19);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("returns unavailable when the index folder cannot be read", async () => {
    await expect(
      measureFolderSize(join(tmpdir(), "ixplorer-index-size-missing")),
    ).resolves.toBeNull();
  });
});
