import { describe, expect, it } from "vitest";

import { ResearchBranchStream } from "@application/use-cases/research/branchStreams";
import type { ResearchStreamEvent } from "@application/contracts/research";

async function* statusThen<R>(
  messages: string[],
  result: R,
  onCleanup?: () => void,
): AsyncGenerator<ResearchStreamEvent, R> {
  try {
    for (const message of messages) {
      yield { type: "status", message };
    }
    return result;
  } finally {
    onCleanup?.();
  }
}

describe("ResearchBranchStream", () => {
  it("interleaves events from both branches and reports each result", async () => {
    const stream = new ResearchBranchStream();
    const first = stream.run(statusThen(["vault"], "vault-result"));
    const second = stream.run(statusThen(["web"], "web-result"));
    const events: ResearchStreamEvent[] = [];

    const generator = stream.until(first);
    for (let step = await generator.next(); !step.done; step = await generator.next()) {
      events.push(step.value);
    }

    await expect(first.result).resolves.toBe("vault-result");
    await expect(second.result).resolves.toBe("web-result");
    expect(events.map((event) => (event as { message: string }).message)).toContain("vault");
  });

  it("runs the cleanup of an abandoned branch when it is closed", async () => {
    const stream = new ResearchBranchStream();
    let cleanedUp = false;
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const branch = stream.run(
      (async function* (): AsyncGenerator<ResearchStreamEvent, string> {
        try {
          yield { type: "status", message: "web" };
          await pending;
          return "web-result";
        } finally {
          cleanedUp = true;
        }
      })(),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    branch.close();
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cleanedUp).toBe(true);
  });

  it("does not close a branch that already finished", async () => {
    const stream = new ResearchBranchStream();
    let cleanupCount = 0;
    const branch = stream.run(statusThen([], "done", () => (cleanupCount += 1)));

    await branch.result;
    await new Promise((resolve) => setTimeout(resolve, 0));
    branch.close();

    expect(cleanupCount).toBe(1);
    await expect(branch.result).resolves.toBe("done");
  });

  it("reports a rejected branch as rejected rather than fulfilled", async () => {
    const stream = new ResearchBranchStream();
    const branch = stream.run(
      (async function* (): AsyncGenerator<ResearchStreamEvent, string> {
        throw new Error("branch failed");
      })(),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(branch.status()).toBe("rejected");
  });

  it("surfaces a branch failure to the consumer that awaits it", async () => {
    const stream = new ResearchBranchStream();
    const branch = stream.run(
      (async function* (): AsyncGenerator<ResearchStreamEvent, string> {
        throw new Error("branch failed");
      })(),
    );

    const generator = stream.until(branch);
    await expect(
      (async () => {
        for (let step = await generator.next(); !step.done; step = await generator.next());
      })(),
    ).rejects.toThrow("branch failed");
  });
});
