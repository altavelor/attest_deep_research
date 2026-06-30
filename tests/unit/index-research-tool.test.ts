import { IndexResearchTool } from "../../src/application/sources/tools/IndexResearchTool";
import { ResearchEvidenceRegistry } from "../../src/adapters/research-tools/ResearchEvidenceRegistry";
import { executeTool } from "../../src/core/agent/tool";
import { ResearchRetriever } from "../../src/application/contracts/research";
import { markdownSource, retrieved } from "../helpers/factories";

describe("IndexResearchTool", () => {
  it("searches the selected retriever without web or query expansion and registers visible chunks", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [
          retrieved("chunk-a", markdownSource("Notes/A.md"), "First result"),
          retrieved("chunk-b", markdownSource("Notes/Visible.md"), "x".repeat(1_200)),
        ],
        citations: [],
        usedFallback: false,
      }),
    };
    const registry = new ResearchEvidenceRegistry();
    const tool = new IndexResearchTool({ retriever, evidence: registry });

    const execution = await executeTool(tool, {
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
          { evidenceId: "chunk-a", chunkId: "chunk-a", path: "Notes/A.md" },
          { evidenceId: "chunk-b", chunkId: "chunk-b", path: "Notes/Visible.md" },
        ],
      },
    });
    if (execution.ok) {
      expect(execution.value.results[1]?.snippet.length).toBe(1_000);
    }
    expect(registry.snapshot().evidence.map((item) => item.id)).toEqual(["chunk-a", "chunk-b"]);
  });

  it("returns successful empty results", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const tool = new IndexResearchTool({ retriever, evidence: new ResearchEvidenceRegistry() });

    await expect(
      executeTool(tool, {
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
      executeTool(tool, {
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
