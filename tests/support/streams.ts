/**
 * Builds a byte stream that delivers each string as one chunk. Without `onCancel` it closes after the
 * last chunk; with `onCancel` it stays open like a live connection and reports the cancel reason.
 */
export function chunkedStream(
  chunks: string[],
  onCancel?: (reason: unknown) => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pending = [...chunks];
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = pending.shift();
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
      else if (!onCancel) controller.close();
      else await new Promise<never>(() => undefined);
    },
    cancel(reason) {
      onCancel?.(reason);
    },
  });
}
