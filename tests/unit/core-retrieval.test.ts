import { filterRetrievedChunks } from "@core/retrieval";
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
});
