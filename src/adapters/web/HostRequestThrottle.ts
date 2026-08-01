// Per-host request throttle for outbound page fetches. Page fetches target
// arbitrary hosts, so they must NOT sit behind the DuckDuckGo *search* rate
// limiter (which serializes every request through one 700ms-spaced chain).
// Instead this throttle:
//   - serializes + spaces requests to the *same* host (politeness against a
//     single origin), and
//   - runs requests to *different* hosts concurrently, capped by a global limit
//     that protects the user's IP / Obsidian's request pipe.
// The net effect: a batch fetch of N pages across N distinct hosts fans out in
// parallel instead of being serialized at ~1.4 req/s.

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface HostRequestThrottleOptions {
  /** Minimum spacing between consecutive requests to the same host. */
  perHostIntervalMs?: number;
  /** Maximum simultaneous in-flight requests across all hosts. */
  maxConcurrent?: number;
  /** Clock injection point for deterministic tests. */
  now?: () => number;
}

const DEFAULT_PER_HOST_INTERVAL_MS = 250;
const DEFAULT_MAX_CONCURRENT = 6;

export class HostRequestThrottle {
  private readonly perHostIntervalMs: number;
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private readonly hostChain = new Map<string, Promise<void>>();
  private readonly hostLastAt = new Map<string, number>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: HostRequestThrottleOptions = {}) {
    this.perHostIntervalMs = Math.max(0, options.perHostIntervalMs ?? DEFAULT_PER_HOST_INTERVAL_MS);
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
    this.now = options.now ?? Date.now;
  }

  /** Run `task` after the host's chain drains, the per-host interval elapses, and a global slot is free. */
  run<T>(host: string, task: () => Promise<T>): Promise<T> {
    const previous = this.hostChain.get(host) ?? Promise.resolve();
    const result = previous.then(async () => {
      const last = this.hostLastAt.get(host);
      const wait = last === undefined ? 0 : this.perHostIntervalMs - (this.now() - last);
      if (wait > 0) await delay(wait);
      await this.acquire();
      this.hostLastAt.set(host, this.now());
      try {
        return await task();
      } finally {
        this.release();
      }
    });
    this.hostChain.set(
      host,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}
