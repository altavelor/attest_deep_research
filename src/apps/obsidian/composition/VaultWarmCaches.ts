import { CachedAsyncValue } from "@application/CachedAsyncValue";
import { ContextFileProvider, LanguageInventoryIndexStore } from "@application/ports";
import { LanguageInventoryItem } from "@core/model";

const DEFAULT_TTL_MS = 30_000;

/**
 * Keeps question-independent inputs of a research turn — the vault path list
 * and the index language inventory — warm across turns. Values are refreshed on
 * vault changes and hold no timers, so closing the chat view releases nothing
 * beyond the cached data itself.
 */
export class VaultWarmCaches {
  private readonly ttlMs: number;
  private readonly paths: CachedAsyncValue<string[]>;
  private readonly languageInventories = new Map<string, LanguageInventoryCacheEntry>();

  constructor(
    private readonly files: ContextFileProvider,
    options: { ttlMs?: number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.paths = new CachedAsyncValue(() => this.files.listPaths(), { ttlMs: this.ttlMs });
  }

  contextFiles(): ContextFileProvider {
    return {
      listPaths: () => this.paths.get(),
      readFile: (path) => this.files.readFile(path),
      ...(this.files.getModifiedTime
        ? { getModifiedTime: (path: string) => this.files.getModifiedTime!(path) }
        : {}),
      ...(this.files.getSize ? { getSize: (path: string) => this.files.getSize!(path) } : {}),
    };
  }

  languageInventory(
    indexProfileId: string,
    store: LanguageInventoryIndexStore,
  ): LanguageInventoryIndexStore {
    return { getLanguageInventory: () => this.languageInventoryCache(indexProfileId, store).get() };
  }

  warm(indexProfileId?: string, store?: LanguageInventoryIndexStore): void {
    this.paths.warm();

    if (indexProfileId && store) {
      this.languageInventoryCache(indexProfileId, store).warm();
    }
  }

  invalidate(): void {
    this.paths.invalidate();

    for (const entry of this.languageInventories.values()) {
      entry.cache.invalidate();
    }
  }

  dispose(): void {
    this.invalidate();
    this.languageInventories.clear();
  }

  private languageInventoryCache(
    indexProfileId: string,
    store: LanguageInventoryIndexStore,
  ): CachedAsyncValue<LanguageInventoryItem[]> {
    const existing = this.languageInventories.get(indexProfileId);

    if (existing) {
      existing.store = store;
      return existing.cache;
    }

    const entry = new LanguageInventoryCacheEntry(store, this.ttlMs);
    this.languageInventories.set(indexProfileId, entry);

    return entry.cache;
  }
}

class LanguageInventoryCacheEntry {
  readonly cache: CachedAsyncValue<LanguageInventoryItem[]>;

  constructor(
    public store: LanguageInventoryIndexStore,
    ttlMs: number,
  ) {
    this.cache = new CachedAsyncValue(() => this.store.getLanguageInventory(), { ttlMs });
  }
}
