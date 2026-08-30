import { afterEach, describe, expect, it, vi } from "vitest";

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<typeof import("obsidian")>()),
  requestUrl,
}));

import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";

function response(body: string, status = 200) {
  const bytes = new TextEncoder().encode(body);
  return { arrayBuffer: bytes.buffer, status, headers: { "x-source": "obsidian" } };
}

describe("obsidianRequestFetch", () => {
  afterEach(() => vi.resetAllMocks());

  it("converts URL, headers, and supported body types to Obsidian's request API", async () => {
    requestUrl.mockResolvedValue(response("ok", 201));
    const body = new TextEncoder().encode("payload").buffer;

    const result = await obsidianRequestFetch(new URL("https://api.example.test/items"), {
      method: "POST",
      headers: new Headers({ Authorization: "Bearer token" }),
      body,
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.example.test/items",
      method: "POST",
      headers: { authorization: "Bearer token" },
      body,
      throw: false,
    });
    expect(result.status).toBe(201);
    expect(result.headers.get("x-source")).toBe("obsidian");
    await expect(result.text()).resolves.toBe("ok");
  });

  it("accepts Request input and tuple headers while discarding unsupported fetch bodies", async () => {
    requestUrl.mockResolvedValue(response("ok"));
    const request = new Request("https://api.example.test/items", { method: "PATCH" });

    await obsidianRequestFetch(request, {
      headers: [["x-mode", "test"]],
      body: new URLSearchParams({ ignored: "yes" }),
    });

    expect(requestUrl).toHaveBeenCalledWith({
      url: "https://api.example.test/items",
      method: "GET",
      headers: { "x-mode": "test" },
      body: undefined,
      throw: false,
    });
  });

  it("rejects immediately and while waiting when the caller aborts", async () => {
    const beforeRequest = new AbortController();
    beforeRequest.abort();
    await expect(
      obsidianRequestFetch("https://api.example.test", { signal: beforeRequest.signal }),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(requestUrl).not.toHaveBeenCalled();

    let resolveRequest: ((value: ReturnType<typeof response>) => void) | undefined;
    requestUrl.mockReturnValue(
      new Promise<ReturnType<typeof response>>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const whileWaiting = new AbortController();
    const pending = obsidianRequestFetch("https://api.example.test", {
      signal: whileWaiting.signal,
    });
    whileWaiting.abort();
    resolveRequest!(response("late"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves a caller-provided abort reason", async () => {
    requestUrl.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const reason = new DOMException("Cancelled by user", "AbortError");
    const pending = obsidianRequestFetch("https://api.example.test", {
      signal: controller.signal,
    });

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it("converts a non-Error abort reason into an AbortError", async () => {
    requestUrl.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const pending = obsidianRequestFetch("https://api.example.test", {
      signal: controller.signal,
    });

    controller.abort("cancelled");

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "The request was aborted.",
    });
  });

  it.each([undefined, new AbortController().signal])(
    "normalizes non-Error request failures with signal %s",
    async (signal) => {
      requestUrl.mockRejectedValue("network failed");

      await expect(obsidianRequestFetch("https://api.example.test", { signal })).rejects.toEqual(
        expect.any(Error),
      );
    },
  );
});
