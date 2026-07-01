import { executeTool } from "@core/agent";
import { WebPageMetadataTool } from "@adapters/research-tools/web/WebPageMetadataTool";
import { SearchProvider } from "@application/ports";

describe("WebPageMetadataTool", () => {
  it("returns parsed metadata for a public URL", async () => {
    const fetchMetadata = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com/a",
      finalUrl: "https://example.com/a",
      metadata: { title: "Title", siteName: "Example", publishedTime: "2024-01-01" },
    });
    const provider: SearchProvider = { search: vi.fn(), fetchMetadata };
    const tool = new WebPageMetadataTool({ provider });

    const execution = await executeTool(tool, {
      id: "call",
      name: "get_page_metadata",
      arguments: { url: "https://example.com/a" },
    });

    expect(fetchMetadata).toHaveBeenCalledWith("https://example.com/a", expect.any(Object));
    expect(execution).toMatchObject({
      ok: true,
      value: {
        metadata: { title: "Title", siteName: "Example" },
        untrustedEvidence: true,
      },
    });
  });

  it("reports unsupported when the provider cannot fetch metadata", async () => {
    const provider: SearchProvider = { search: vi.fn() };
    const tool = new WebPageMetadataTool({ provider });
    await expect(
      executeTool(tool, {
        id: "call",
        name: "get_page_metadata",
        arguments: { url: "https://example.com/a" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "web-metadata-unsupported" } });
  });

  it("rejects non-public URLs before any network access", async () => {
    const fetchMetadata = vi.fn();
    const provider: SearchProvider = { search: vi.fn(), fetchMetadata };
    const tool = new WebPageMetadataTool({ provider });
    await expect(
      executeTool(tool, {
        id: "call",
        name: "get_page_metadata",
        arguments: { url: "http://127.0.0.1/" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "unsafe-web-url" } });
    expect(fetchMetadata).not.toHaveBeenCalled();
  });
});
