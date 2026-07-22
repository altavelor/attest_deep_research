// Bounded-concurrency limiter used by ThinkingResearchRunner to run several
// `run_subagent` calls within one round concurrently instead of one at a time.
// No external dependency: a small counting semaphore over a FIFO wait queue.

export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}
