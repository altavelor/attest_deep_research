import { ResearchStreamEvent } from "@application/contracts/research";

export type ResearchBranchStatus = "pending" | "fulfilled" | "rejected" | "abandoned";

export interface ResearchBranch<R> {
  result: Promise<R>;
  status(): ResearchBranchStatus;

  /**
   * Abandon the branch: stops forwarding its events, marks it abandoned and
   * closes the generator so its cleanup runs. A provider that never settles
   * keeps its own promise pending, but no longer holds up or feeds the stream.
   */
  close(): void;
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
    let status: ResearchBranchStatus = "pending";
    let abandoned = false;
    const result = (async () => {
      let next = await generator.next();
      while (!next.done) {
        if (abandoned) {
          await generator.return(undefined as unknown as R);
          break;
        }
        this.push(next.value);
        next = await generator.next();
      }
      return next.done ? next.value : (undefined as unknown as R);
    })();
    const track = (settled: ResearchBranchStatus) => () => {
      if (status === "pending") {
        status = settled;
      }
      this.push(undefined);
    };

    result.then(track("fulfilled"), track("rejected"));
    void result.catch(() => undefined);

    return {
      result,
      status: () => status,
      close: () => {
        if (status !== "pending") {
          return;
        }
        status = "abandoned";
        abandoned = true;
        void Promise.resolve(generator.return(undefined as unknown as R)).catch(() => undefined);
        this.push(undefined);
      },
    };
  }

  /** Yield buffered events until `branch` settles, then surface its outcome. */
  async *until<R>(branch: ResearchBranch<R>): AsyncGenerator<ResearchStreamEvent, R> {
    for (;;) {
      for (const event of this.buffered.splice(0)) {
        yield event;
      }

      if (branch.status() === "abandoned") {
        throw new Error("Research branch was abandoned.");
      }

      if (branch.status() !== "pending") {
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
