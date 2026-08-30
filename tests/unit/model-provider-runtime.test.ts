import { AttestError } from "@core/errors";
import type { ServerProfile } from "@adapters/settings";
import { obsidianRequestFetch } from "@apps/obsidian/obsidianFetch";
import { isMobileLocalProvider, resolveProviderFetch } from "@apps/obsidian/modelProviderRuntime";

function server(apiFormat: ServerProfile["apiFormat"], baseUrl: string): ServerProfile {
  return {
    id: "server",
    name: "Server",
    apiFormat,
    baseUrl,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("model provider runtime", () => {
  it("routes every mobile cloud request through requestUrl while desktop keeps direct fetch", () => {
    const cloud = server("openai-compatible", "https://api.example.test/v1");

    expect(resolveProviderFetch(cloud, "streaming", true)).toBe(obsidianRequestFetch);
    expect(resolveProviderFetch(cloud, "buffered", true)).toBe(obsidianRequestFetch);
    expect(resolveProviderFetch(cloud, "streaming", false)).toBe(fetch);
    expect(resolveProviderFetch(cloud, "buffered", false)).toBe(fetch);
  });

  it.each([
    server("ollama", "https://remote-ollama.example.test"),
    server("openai-compatible", "http://localhost:1234/v1"),
    server("openai-compatible", "http://127.23.4.5:1234/v1"),
    server("openai-compatible", "http://[::1]:1234/v1"),
  ])("rejects mobile local provider $baseUrl before network I/O", async (profile) => {
    expect(isMobileLocalProvider(profile)).toBe(true);
    const mobileFetch = resolveProviderFetch(profile, "streaming", true);

    await expect(mobileFetch(profile.baseUrl)).rejects.toEqual(
      expect.objectContaining<Partial<AttestError>>({
        code: "UNSUPPORTED_CAPABILITY",
        message: expect.stringContaining("not available on Obsidian Mobile"),
      }),
    );
  });

  it("does not classify LAN or cloud OpenAI-compatible endpoints as local", () => {
    expect(isMobileLocalProvider(server("openai-compatible", "http://192.168.1.10:1234/v1"))).toBe(
      false,
    );
    expect(isMobileLocalProvider(server("openai-compatible", "https://openrouter.ai/api/v1"))).toBe(
      false,
    );
  });
});
