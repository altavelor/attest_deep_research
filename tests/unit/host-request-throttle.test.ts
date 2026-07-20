import { HostRequestThrottle } from "@adapters/web/HostRequestThrottle";

/** A task that resolves only when told to, tracking its in-flight state. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Flush all pending microtasks (the throttle defers task starts across a .then chain). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("HostRequestThrottle", () => {
  it("runs requests to distinct hosts concurrently", async () => {
    const throttle = new HostRequestThrottle({ perHostIntervalMs: 0, maxConcurrent: 6 });
    const a = deferred();
    const b = deferred();
    let aStarted = false;
    let bStarted = false;

    const pa = throttle.run("a.example", async () => {
      aStarted = true;
      await a.promise;
    });
    const pb = throttle.run("b.example", async () => {
      bStarted = true;
      await b.promise;
    });

    await flush();
    // Both started without either finishing: distinct hosts do not serialize.
    expect(aStarted).toBe(true);
    expect(bStarted).toBe(true);

    a.resolve();
    b.resolve();
    await Promise.all([pa, pb]);
  });

  it("serializes requests to the same host", async () => {
    const throttle = new HostRequestThrottle({ perHostIntervalMs: 0, maxConcurrent: 6 });
    const first = deferred();
    let secondStarted = false;

    const p1 = throttle.run("a.example", async () => {
      await first.promise;
    });
    const p2 = throttle.run("a.example", async () => {
      secondStarted = true;
    });

    await flush();
    expect(secondStarted).toBe(false); // waits behind the first same-host request

    first.resolve();
    await Promise.all([p1, p2]);
    expect(secondStarted).toBe(true);
  });

  it("caps global concurrency across hosts", async () => {
    const throttle = new HostRequestThrottle({ perHostIntervalMs: 0, maxConcurrent: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started = [false, false, false];

    const runs = gates.map((gate, i) =>
      throttle.run(`h${i}.example`, async () => {
        started[i] = true;
        await gate.promise;
      }),
    );

    await flush();
    // Only maxConcurrent=2 may run; the third parks until a slot frees.
    expect(started).toEqual([true, true, false]);

    gates[0].resolve();
    await flush();
    expect(started[2]).toBe(true);

    gates[1].resolve();
    gates[2].resolve();
    await Promise.all(runs);
  });

  it("propagates task rejection without poisoning the host queue", async () => {
    const throttle = new HostRequestThrottle({ perHostIntervalMs: 0, maxConcurrent: 6 });

    await expect(
      throttle.run("a.example", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(throttle.run("a.example", async () => "ok")).resolves.toBe("ok");
  });
});
