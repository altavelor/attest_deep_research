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
  private generation = 0;

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

    const generation = this.generation;
    const request: Promise<T> = this.load()
      .then((value) => {
        if (generation === this.generation) {
          this.cached = { value, loadedAt: this.now() };
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight === request) {
          this.inFlight = undefined;
        }
      });
    this.inFlight = request;

    return request;
  }

  /** Load ahead of the first read; failures are left for the real read to report. */
  warm(): void {
    void this.get().catch(() => undefined);
  }

  /** Drops the cached value and disowns any load started before this point. */
  invalidate(): void {
    this.generation += 1;
    this.cached = undefined;
    this.inFlight = undefined;
  }
}
