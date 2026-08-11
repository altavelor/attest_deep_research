import { describe, expect, it } from "vitest";

import {
  isInsideVaultFolder,
  joinVaultPath,
  resolveInsideVaultFolder,
  vaultBasename,
  vaultDirname,
} from "@shared";

describe("joinVaultPath", () => {
  it("joins segments with forward slashes", () => {
    expect(joinVaultPath("a", "b", "c.json")).toBe("a/b/c.json");
  });

  it("drops empty, nullish and dot segments", () => {
    expect(joinVaultPath("", "a", undefined, ".", null, "b")).toBe("a/b");
  });

  it("collapses duplicate and leading slashes", () => {
    expect(joinVaultPath("/a//b/", "/c")).toBe("a/b/c");
  });

  it("converts backslashes to forward slashes", () => {
    expect(joinVaultPath("a\\b", "c")).toBe("a/b/c");
  });

  it("resolves parent segments without escaping the root", () => {
    expect(joinVaultPath("a/b", "..", "c")).toBe("a/c");
    expect(joinVaultPath("a", "../../../..", "b")).toBe("b");
  });

  it("returns an empty string for an empty input", () => {
    expect(joinVaultPath()).toBe("");
    expect(joinVaultPath("", "/")).toBe("");
  });
});

describe("vaultDirname", () => {
  it("returns the parent folder", () => {
    expect(vaultDirname("a/b/c.json")).toBe("a/b");
  });

  it("returns an empty string at the root", () => {
    expect(vaultDirname("c.json")).toBe("");
    expect(vaultDirname("/c.json")).toBe("");
    expect(vaultDirname("")).toBe("");
  });

  it("ignores a trailing slash", () => {
    expect(vaultDirname("a/b/")).toBe("a");
  });
});

describe("vaultBasename", () => {
  it("returns the final segment", () => {
    expect(vaultBasename("a/b/c.json")).toBe("c.json");
    expect(vaultBasename("c.json")).toBe("c.json");
  });

  it("ignores a trailing slash", () => {
    expect(vaultBasename("a/b/")).toBe("b");
  });

  it("strips a matching suffix", () => {
    expect(vaultBasename("a/b/c.json", ".json")).toBe("c");
    expect(vaultBasename("a/b/c.json", ".txt")).toBe("c.json");
  });

  it("keeps the name when it equals the suffix", () => {
    expect(vaultBasename("a/.json", ".json")).toBe(".json");
  });
});

describe("isInsideVaultFolder", () => {
  it("accepts the folder itself and its descendants", () => {
    expect(isInsideVaultFolder("index", "index")).toBe(true);
    expect(isInsideVaultFolder("index", "index/chunks/a.json")).toBe(true);
  });

  it("rejects siblings sharing a name prefix", () => {
    expect(isInsideVaultFolder("index", "index-backup/a.json")).toBe(false);
  });

  it("rejects paths outside the folder", () => {
    expect(isInsideVaultFolder("index", "other/a.json")).toBe(false);
  });

  it("treats the vault root as containing any non-empty path", () => {
    expect(isInsideVaultFolder("", "a.json")).toBe(true);
    expect(isInsideVaultFolder("", "")).toBe(false);
  });
});

describe("resolveInsideVaultFolder", () => {
  it("resolves a child path", () => {
    expect(resolveInsideVaultFolder("index", "chunks", "a.json")).toBe("index/chunks/a.json");
  });

  it("rejects traversal out of the folder", () => {
    expect(() => resolveInsideVaultFolder("index", "../secrets.json")).toThrow(/escapes/);
    expect(() => resolveInsideVaultFolder("index", "a/../../secrets.json")).toThrow(/escapes/);
  });

  it("rejects an absolute-looking segment that resolves to the folder itself", () => {
    expect(() => resolveInsideVaultFolder("index", "/")).toThrow(/escapes/);
    expect(() => resolveInsideVaultFolder("index", "")).toThrow(/escapes/);
  });

  it("normalizes backslash traversal", () => {
    expect(() => resolveInsideVaultFolder("index", "..\\secrets.json")).toThrow(/escapes/);
  });
});
