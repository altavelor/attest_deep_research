export interface CachedAsyncValueOptions {
  ttlMs: number;
  now?: () => number;
}

/**
 * Caches one asynchronous value for a short time and collapses concurrent
 * loads into a single call. Freshness is checked on read, so a cached value
 * holds no timers and nothing needs to be released when its owner goes away.
 */
export class CachedAsyncValue<T> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cached?: { value: T; loadedAt: number };
  private inFlight?: Promise<T>;

  constructor(
    private readonly load: () => Promise<T>,
    options: CachedAsyncValueOptions,
  ) {
    this.ttlMs = Math.max(0, options.ttlMs);
    this.now = options.now ?? (() => Date.now());
  }

  get(): Promise<T> {
    const cached = this.cached;

    if (cached && this.now() - cached.loadedAt < this.ttlMs) {
      return Promise.resolve(cached.value);
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const request = this.load()
      .then((value) => {
        this.cached = { value, loadedAt: this.now() };
        return value;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    this.inFlight = request;

    return request;
  }

  /** Load ahead of the first read; failures are left for the real read to report. */
  warm(): void {
    void this.get().catch(() => undefined);
  }

  invalidate(): void {
    this.cached = undefined;
  }
}
