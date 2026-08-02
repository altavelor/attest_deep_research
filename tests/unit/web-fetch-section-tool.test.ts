import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { executeTool } from "@core/agent";
import { WebFetchSectionTool } from "@adapters/research-tools/web/WebFetchSectionTool";
import { SearchProvider } from "@application/ports";

const PAGE =
  "Intro about nothing in particular. The treaty was signed in 1815. " +
  "It ended the war between the two nations. Later trade resumed across the border.";

describe("WebFetchSectionTool", () => {
  function setup() {
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://example.com/a",
      finalUrl: "https://example.com/a",
      content: PAGE,
      contentType: "text/html",
      bytes: PAGE.length,
      truncated: false,
      redirects: [],
    });
    const provider: SearchProvider = { search: vi.fn(), fetchPage };
    const evidence = new ResearchEvidenceRegistry({ createHandle: () => "sec-handle" });
    const registered = evidence.registerWebResult(
      { url: "https://example.com/a", title: "A", snippet: "s", rank: 1 },
      { callId: "search", query: "q" },
    );
    return {
      tool: new WebFetchSectionTool({ provider, evidence }),
      evidence,
      registered,
      fetchPage,
    };
  }

  it("returns only passages relevant to the focused query", async () => {
    const { tool, registered } = setup();

    const execution = await executeTool(tool, {
      id: "call",
      name: "fetch_web_section",
      arguments: { resultId: registered.resultId, query: "treaty signed war", limit: 2 },
    });

    expect(execution.ok).toBe(true);
    if (!execution.ok) return;
    expect(execution.value.sections.length).toBeGreaterThan(0);
    expect(execution.value.sections[0]?.text).toContain("treaty");

    expect(execution.value.sections.every((s) => !s.text.includes("trade resumed"))).toBe(true);
    expect(execution.value.diagnostics.untrustedEvidence).toBe(true);
  });

  it("upgrades evidence with the fetched page so citations resolve", async () => {
    const { tool, evidence, registered } = setup();
    await executeTool(tool, {
      id: "call",
      name: "fetch_web_section",
      arguments: { resultId: registered.resultId, query: "treaty", limit: 2 },
    });
    expect(evidence.snapshot().evidence[0]?.text).toContain("treaty");
  });

  it("rejects an unregistered resultId", async () => {
    const { tool } = setup();
    await expect(
      executeTool(tool, {
        id: "call",
        name: "fetch_web_section",
        arguments: { resultId: "missing", query: "treaty", limit: 2 },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "unknown-web-result" } });
  });
});
