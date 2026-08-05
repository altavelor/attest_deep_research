import { describe, expect, it } from "vitest";

import { CachedAsyncValue } from "@application/CachedAsyncValue";
import { VaultWarmCaches } from "@apps/obsidian/composition/VaultWarmCaches";
import { ContextFileProvider } from "@application/ports";
import { LanguageInventoryItem } from "@core/model";

function countingFiles(paths: string[]): ContextFileProvider & { listCalls: number } {
  return {
    listCalls: 0,
    async listPaths() {
      this.listCalls += 1;
      return paths;
    },
    async readFile() {
      return "";
    },
  };
}

describe("CachedAsyncValue", () => {
  it("serves a cached value inside the TTL and reloads after it expires", async () => {
    let clock = 0;
    let loads = 0;
    const value = new CachedAsyncValue(
      async () => {
        loads += 1;
        return loads;
      },
      { ttlMs: 100, now: () => clock },
    );

    await expect(value.get()).resolves.toBe(1);
    clock = 50;
    await expect(value.get()).resolves.toBe(1);
    clock = 150;
    await expect(value.get()).resolves.toBe(2);
    expect(loads).toBe(2);
  });

  it("collapses concurrent loads into a single call", async () => {
    let loads = 0;
    const value = new CachedAsyncValue(
      async () => {
        loads += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return loads;
      },
      { ttlMs: 1_000 },
    );

    await Promise.all([value.get(), value.get(), value.get()]);

    expect(loads).toBe(1);
  });

  it("reloads after invalidation and reports load failures to readers", async () => {
    let failNext = false;
    let loads = 0;
    const value = new CachedAsyncValue(
      async () => {
        loads += 1;
        if (failNext) throw new Error("load failed");
        return loads;
      },
      { ttlMs: 1_000 },
    );

    await value.get();
    value.invalidate();
    await expect(value.get()).resolves.toBe(2);

    failNext = true;
    value.invalidate();
    await expect(value.get()).rejects.toThrow("load failed");
  });

  it("does not cache a value loaded before an invalidation", async () => {
    let release: ((value: number) => void) | undefined;
    let loads = 0;
    const value = new CachedAsyncValue(
      () => {
        loads += 1;
        return new Promise<number>((resolve) => {
          release = resolve;
        });
      },
      { ttlMs: 10_000 },
    );

    const stale = value.get();
    value.invalidate();
    release!(1);
    await expect(stale).resolves.toBe(1);

    const fresh = value.get();
    release!(2);

    await expect(fresh).resolves.toBe(2);
    expect(loads).toBe(2);
  });
});

describe("VaultWarmCaches", () => {
  it("reuses the warmed path list and refreshes it after invalidation", async () => {
    const files = countingFiles(["A.md", "B.md"]);
    const caches = new VaultWarmCaches(files, { ttlMs: 10_000 });
    const provider = caches.contextFiles();

    await expect(provider.listPaths()).resolves.toEqual(["A.md", "B.md"]);
    await provider.listPaths();
    expect(files.listCalls).toBe(1);

    caches.invalidate();
    await provider.listPaths();
    expect(files.listCalls).toBe(2);
  });

  it("caches the language inventory per index profile", async () => {
    const inventory: LanguageInventoryItem[] = [{ language: "en", chunkCount: 2, sourceCount: 1 }];
    let calls = 0;
    const store = {
      async getLanguageInventory() {
        calls += 1;
        return inventory;
      },
    };
    const caches = new VaultWarmCaches(countingFiles([]), { ttlMs: 10_000 });

    await caches.languageInventory("profile-1", store).getLanguageInventory();
    await caches.languageInventory("profile-1", store).getLanguageInventory();
    expect(calls).toBe(1);

    await caches.languageInventory("profile-2", store).getLanguageInventory();
    expect(calls).toBe(2);
  });

  it("drops cached data on dispose", async () => {
    const files = countingFiles(["A.md"]);
    const caches = new VaultWarmCaches(files, { ttlMs: 10_000 });

    await caches.contextFiles().listPaths();
    caches.dispose();
    await caches.contextFiles().listPaths();

    expect(files.listCalls).toBe(2);
  });
});
