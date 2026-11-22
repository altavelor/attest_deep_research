import { parseServerSentEvents } from "@adapters/model-provider/common/streams";
import { chunkedStream } from "../support/streams";

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of parseServerSentEvents(stream)) items.push(item);
  return items;
}

describe("parseServerSentEvents", () => {
  it("separates events on CRLF and CR line endings, including a CRLF split across chunks", async () => {
    await expect(
      collect(chunkedStream(["data: a\r", "", "\ndata: b\r\n\r\ndata: c\r\rdata: [DONE]\r\n\r\n"])),
    ).resolves.toEqual(["a\nb", "c", "[DONE]"]);
  });

  it("dispatches a CR-terminated event without waiting for more bytes", async () => {
    const iterator = parseServerSentEvents(chunkedStream(["data: ok\r\r"], vi.fn()))[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: "ok" });
    await iterator.return?.();
  });

  it("ignores comment lines and comment-only events", async () => {
    await expect(
      collect(chunkedStream([": OPENROUTER PROCESSING\n\n: note\ndata: x\n\n"])),
    ).resolves.toEqual(["x"]);
  });

  it("cancels the body and rejects with the abort reason while a read is pending", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const onCancel = vi.fn();
    const iterator = parseServerSentEvents(chunkedStream([], onCancel), controller.signal)[
      Symbol.asyncIterator
    ]();
    const next = iterator.next();
    controller.abort(reason);

    await expect(next).rejects.toBe(reason);
    expect(onCancel).toHaveBeenCalledWith(reason);
  });

  it("rejects instead of yielding a buffered event once the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    const iterator = parseServerSentEvents(
      chunkedStream(["data: a\n\ndata: [DONE]\n\n"], vi.fn()),
      controller.signal,
    )[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: "a" });
    controller.abort(reason);
    await expect(iterator.next()).rejects.toBe(reason);
  });

  it("rejects with an AbortError and cancels with the raw reason when aborted before reading", async () => {
    const controller = new AbortController();
    const onCancel = vi.fn();
    controller.abort("x");
    const iterator = parseServerSentEvents(chunkedStream([], onCancel), controller.signal)[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(onCancel).toHaveBeenCalledWith("x");
  });

  it("cancels the body when the consumer stops early", async () => {
    const onCancel = vi.fn();
    for await (const item of parseServerSentEvents(chunkedStream(["data: a\n\n"], onCancel))) {
      expect(item).toBe("a");
      break;
    }
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
