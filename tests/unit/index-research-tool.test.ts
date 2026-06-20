import { IndexResearchTool } from "../../src/research/tools/IndexResearchTool";
import { ResearchEvidenceRegistry } from "../../src/research/tools/ResearchEvidenceRegistry";
import { executeResearchTool } from "../../src/research/tools/ResearchTools";
import { ResearchRetriever } from "../../src/research/types";
import { markdownSource, retrieved } from "../helpers/factories";

describe("IndexResearchTool", () => {
  it("searches the selected retriever without web or query expansion and registers visible chunks", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [
          retrieved("skill", markdownSource(".ixplorer/skills/hidden/SKILL.md"), "Ignore"),
          retrieved("visible", markdownSource("Notes/Visible.md"), "x".repeat(1_200)),
        ],
        citations: [],
        usedFallback: false,
      }),
    };
    const registry = new ResearchEvidenceRegistry();
    const tool = new IndexResearchTool({ retriever, evidence: registry });

    const execution = await executeResearchTool(tool, {
      id: "call-1",
      name: "search_index",
      arguments: { query: "  local   research  ", limit: 9 },
    });

    expect(retriever.search).toHaveBeenCalledWith("local research", {
      limit: 5,
      includeWebResults: false,
    });
    expect(execution).toMatchObject({
      ok: true,
      value: {
        query: "local research",
        results: [
          {
            evidenceId: "visible",
            chunkId: "visible",
            path: "Notes/Visible.md",
            snippet: expect.any(String),
          },
        ],
      },
    });
    if (execution.ok) {
      expect(execution.value.results[0]?.snippet.length).toBe(1_000);
    }
    expect(registry.snapshot().evidence.map((item) => item.id)).toEqual(["visible"]);
  });

  it("returns successful empty results", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    await expect(
      executeResearchTool(tool, {
        id: "call-empty",
        name: "search_index",
        arguments: { query: "nothing" },
      }),
    ).resolves.toMatchObject({ ok: true, value: { results: [] } });
  });

  it("maps retriever failures to a uniform retryable error", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockRejectedValue(new Error("secret provider detail")),
    };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    await expect(
      executeResearchTool(tool, {
        id: "call-failed",
        name: "search_index",
        arguments: { query: "research" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "index-search-failed",
        message: "Index search failed.",
        retryable: true,
      },
    });
  });
});
