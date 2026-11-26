/**
 * Runs a promise-based task and yields the events it pushes, in push order, while it runs. The
 * task's result is the generator's return value and its failure is rethrown after queued events.
 */
export async function* pumpEvents<E, T>(
  task: (push: (event: E) => void) => Promise<T>,
): AsyncGenerator<E, T> {
  const queue: E[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  const push = (event: E): void => {
    queue.push(event);
    wake?.();
  };
  const running = task(push).finally(() => {
    finished = true;
    wake?.();
  });
  running.catch(() => undefined);
  for (;;) {
    while (queue.length > 0) yield queue.shift()!;
    if (finished) return await running;
    await new Promise<void>((resolve) => (wake = resolve));
    wake = null;
  }
}
