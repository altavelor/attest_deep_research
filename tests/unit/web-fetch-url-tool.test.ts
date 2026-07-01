import { ResearchEvidenceRegistry } from "../../src/adapters/research-tools/ResearchEvidenceRegistry";
import { executeTool } from "@core/agent";
import { WebFetchUrlTool } from "../../src/adapters/research-tools/web/WebFetchUrlTool";
import { SearchProvider } from "@application/ports";

function pageResponse(content: string) {
  return {
    ok: true,
    url: "https://example.com/article",
    finalUrl: "https://example.com/article",
    content,
    contentType: "text/html",
    bytes: content.length,
    truncated: false,
    redirects: [],
  };
}

describe("WebFetchUrlTool", () => {
  it("registers a fresh URL, fetches it, and returns page content as evidence", async () => {
    const fetchPage = vi.fn().mockResolvedValue(pageResponse("Direct page body."));
    const provider: SearchProvider = { search: vi.fn(), fetchPage };
    const evidence = new ResearchEvidenceRegistry({ createHandle: () => "url-handle" });
    const tool = new WebFetchUrlTool({ provider, evidence });

    const execution = await executeTool(tool, {
      id: "call",
      name: "fetch_url",
      arguments: { url: "https://example.com/article" },
    });

    expect(fetchPage).toHaveBeenCalledWith("https://example.com/article", expect.any(Object));
    expect(execution).toMatchObject({
      ok: true,
      value: { content: "Direct page body.", untrustedEvidence: true },
    });
    expect(evidence.snapshot().evidence[0]?.text).toBe("Direct page body.");
  });

  it("rejects non-public URLs before any network access", async () => {
    const fetchPage = vi.fn();
    const provider: SearchProvider = { search: vi.fn(), fetchPage };
    const tool = new WebFetchUrlTool({
      provider,
      evidence: new ResearchEvidenceRegistry({ createHandle: () => "h" }),
    });

    await expect(
      executeTool(tool, {
        id: "call",
        name: "fetch_url",
        arguments: { url: "http://localhost/secret" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "unsafe-web-url" } });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
