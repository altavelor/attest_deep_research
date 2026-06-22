export interface AsyncEventChannel<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
}

export function createAsyncEventChannel<T>(): AsyncEventChannel<T> {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ done: false, value });
      else values.push(value);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const waiter of waiters.splice(0)) waiter({ done: true, value: undefined });
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          const value = values.shift();
          if (value !== undefined) return Promise.resolve({ done: false, value });
          if (closed) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
  };
}
