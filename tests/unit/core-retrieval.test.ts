// Stage 2: the RAG ranking/filtering/citation logic now lives in core and is
// importable + testable without any adapter, node, or DOM dependency.
import { rankKeywordMatches } from "@adapters/retrieval";
import { filterRetrievedChunks } from "@core/retrieval";
import { formatCitation } from "@core/retrieval";
import type { RetrievedChunk } from "@core/model";

function chunk(id: string, text: string, score: number, path = `${id}.md`): RetrievedChunk {
  return {
    id,
    text,
    score,
    contentHash: id,
    source: { kind: "markdown", id, title: id, path, headingPath: [] },
  };
}

describe("core/retrieval", () => {
  it("ranks chunks by keyword occurrences, then by base score", () => {
    const ranked = rankKeywordMatches(
      "vector search",
      [chunk("a", "vector vector search", 0.1), chunk("b", "search", 0.9), chunk("c", "nope", 0.5)],
      10,
    );
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("filters out web chunks unless web results are included", () => {
    const web: RetrievedChunk = {
      id: "w",
      text: "x",
      score: 1,
      contentHash: "w",
      source: {
        kind: "web",
        id: "w",
        title: "t",
        url: "https://e.com",
        snippet: "",
        retrievedAt: "",
        wasContentFetched: false,
      },
    };
    const out = filterRetrievedChunks([chunk("a", "x", 1), web], {
      limit: 10,
      includeWebResults: false,
    });
    expect(out.map((c) => c.id)).toEqual(["a"]);
  });

  it("formats a citation label from the source", () => {
    const citation = formatCitation({
      kind: "markdown",
      id: "n",
      title: "Note",
      path: "Note.md",
      headingPath: ["A", "B"],
    });
    expect(citation.label).toBe("Note.md > A > B");
  });
});
