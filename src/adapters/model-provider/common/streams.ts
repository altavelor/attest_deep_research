/**
 * Yields the `data` payload of each server-sent event, accepting any line ending and skipping comments.
 * Aborting `signal` cancels the body and rejects with its reason; an early consumer exit cancels the body.
 */
export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  try {
    while (true) {
      if (signal?.aborted) throw abortReason(signal);
      const { done, value } = await readUnlessAborted(reader, signal);
      if (done) break;

      buffer = normalizeLineEndings(buffer + decoder.decode(value, { stream: true }));
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const data = parseServerSentEventData(event);
        if (data) yield data;
      }
    }

    const data = parseServerSentEventData((buffer + decoder.decode()).replace(/\r\n?/g, "\n"));
    finished = true;
    if (data) yield data;
  } catch (error) {
    if (!signal?.aborted) throw error;
    finished = true;
    await reader.cancel(signal.reason).catch(() => undefined);
    throw abortReason(signal);
  } finally {
    if (finished) reader.releaseLock();
    else await reader.cancel().catch(() => undefined);
  }
}

/** Reads one chunk, rejecting as soon as `signal` aborts; the abort listener lives only for this read. */
function readUnlessAborted(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return reader.read();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    reader
      .read()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function abortReason(signal: AbortSignal | undefined): unknown {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("The request was aborted.", "AbortError");
}

function normalizeLineEndings(buffer: string): string {
  const trailingCarriageReturn = buffer.endsWith("\r");
  const normalized = (trailingCarriageReturn ? buffer.slice(0, -1) : buffer).replace(
    /\r\n?/g,
    "\n",
  );
  return trailingCarriageReturn ? `${normalized}\r` : normalized;
}

function parseServerSentEventData(event: string): string {
  return event
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
}
