/**
 * Yields the `data` payload of each server-sent event, accepting any line ending and skipping comments.
 * A CR ends its line at once, and the LF that may follow it in the next chunk is dropped.
 * Aborting `signal` cancels the body and rejects with its reason, even between buffered events.
 */
export async function* parseServerSentEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let afterCarriageReturn = false;
  let finished = false;
  try {
    while (true) {
      if (signal?.aborted) throw abortReason(signal);
      const { done, value } = await readUnlessAborted(reader, signal);
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (text.length === 0) continue;
      const unpaired = afterCarriageReturn && text.startsWith("\n") ? text.slice(1) : text;
      afterCarriageReturn = text.endsWith("\r");
      buffer += normalizeLineEndings(unpaired);
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const data = parseServerSentEventData(event);
        if (!data) continue;
        if (signal?.aborted) throw abortReason(signal);
        yield data;
      }
    }

    const data = parseServerSentEventData(buffer + normalizeLineEndings(decoder.decode()));
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

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function parseServerSentEventData(event: string): string {
  return event
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");
}
