/**
 * Map over items with a bounded number of in-flight tasks. Results keep the
 * input order regardless of completion order; the first rejection propagates
 * once the already-started tasks settle.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  let next = 0;

  const run = async (): Promise<void> => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workers }, run));

  return results;
}
