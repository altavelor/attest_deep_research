export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return items;
}

/** Lets pending promise continuations and immediate callbacks run for a number of event-loop turns without reading the clock. */
export async function settle(turns = 50): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/**
 * Retries an assertion between event-loop turns until it passes and rethrows its last failure once the turns run out.
 * Unlike `vi.waitFor`, it never waits on the clock, so a test stays as fast as the code it drives.
 */
export async function eventually(assertion: () => unknown, turns = 200): Promise<void> {
  let failure: unknown;
  for (let turn = 0; turn < turns; turn += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      failure = error;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw failure;
}
