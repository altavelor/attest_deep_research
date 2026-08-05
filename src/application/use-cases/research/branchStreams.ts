import { ResearchStreamEvent } from "@application/contracts/research";

export interface ResearchBranch<R> {
  result: Promise<R>;
  isSettled(): boolean;
}

/**
 * Multiplexes concurrently running research branches (vault, web) into a single
 * event stream. A branch keeps producing events after the consumer stops
 * draining, and an abandoned branch never surfaces an unhandled rejection.
 */
export class ResearchBranchStream {
  private buffered: ResearchStreamEvent[] = [];
  private wake?: () => void;

  run<R>(generator: AsyncGenerator<ResearchStreamEvent, R>): ResearchBranch<R> {
    let settled = false;
    const result = (async () => {
      let next = await generator.next();
      while (!next.done) {
        this.push(next.value);
        next = await generator.next();
      }
      return next.value;
    })();
    const track = <T>(value: T): T => {
      settled = true;
      this.push(undefined);
      return value;
    };

    result.then(track, track);
    void result.catch(() => undefined);

    return { result, isSettled: () => settled };
  }

  /** Yield buffered events until `branch` settles, then surface its outcome. */
  async *until<R>(branch: ResearchBranch<R>): AsyncGenerator<ResearchStreamEvent, R> {
    for (;;) {
      for (const event of this.buffered.splice(0)) {
        yield event;
      }

      if (branch.isSettled()) {
        return await branch.result;
      }

      await this.activity();
    }
  }

  private push(event: ResearchStreamEvent | undefined): void {
    if (event) {
      this.buffered.push(event);
    }

    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  private activity(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }
}
