import {
  buildKeywordPostingRows,
  rankKeywordPostings,
  tokenizeForKeywordIndex,
} from "@adapters/indexing";
import { FileVectorChunkRow } from "@adapters/indexing";

describe("LightweightKeywordIndex", () => {
  it("tokenizes with lowercase punctuation splitting and minTokenLength only", () => {
    expect(tokenizeForKeywordIndex("A local-first, LOCAL_model note.", 3)).toEqual([
      "local",
      "first",
      "local_model",
      "note",
    ]);
  });

  it("builds posting rows and ranks matches deterministically", () => {
    const rows = buildKeywordPostingRows(
      [
        chunk("chunk-a", "Local model local retrieval"),
        chunk("chunk-b", "Local notes"),
        chunk("chunk-c", "Remote server"),
      ],
      3,
    );

    const matches = rankKeywordPostings("local retrieval", rows, 3, 3);

    expect(matches.map((match) => match.chunkId)).toEqual(["chunk-a", "chunk-b"]);
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
    for (const match of matches) {
      expect(match.score).toBeGreaterThan(0);
    }
  });

  it("ranks a rare-term match above a long chunk saturated with common terms", () => {
    // Регресс из бага search_index: чанк, набитый частым термом, выигрывал у
    // чанка с редким термом запроса за счёт сырого TF без IDF и нормализации.
    const commonFiller = Array.from({ length: 50 }, () => "the mail service").join(" ");
    const rows = buildKeywordPostingRows(
      [
        chunk("chunk-noise", commonFiller),
        chunk("chunk-riquet", "Riquet with the Tuft was, once upon a time, the son of the Queen"),
        chunk("chunk-other", "the queen read the mail about the service"),
      ],
      3,
    );

    const matches = rankKeywordPostings("riquet the tuft fairy tale", rows, 3, 3);

    expect(matches[0].chunkId).toBe("chunk-riquet");
  });

  it("boosts chunks whose section heading matches the query term", () => {
    const rows = buildKeywordPostingRows(
      [
        chunkWithHeading("chunk-heading", "Once upon a time there was a Queen", [
          "Riquet with the Tuft",
        ]),
        chunk("chunk-body", "Riquet spoke about the Queen and the palace once more"),
      ],
      3,
    );

    // Постинг заголовочного вхождения несёт headingFrequency.
    const riquetRow = rows.find((row) => row.term === "riquet");
    expect(riquetRow?.postings.find((p) => p.chunkId === "chunk-heading")?.headingFrequency).toBe(1);

    const matches = rankKeywordPostings("riquet", rows, 3, 2);
    expect(matches[0].chunkId).toBe("chunk-heading");
  });

  it("returns no matches for empty or too-short queries", () => {
    const rows = buildKeywordPostingRows([chunk("chunk-a", "local model")], 3);

    expect(rankKeywordPostings("to be", rows, 3, 5)).toEqual([]);
    expect(rankKeywordPostings("local", rows, 3, 0)).toEqual([]);
  });
});

function chunk(id: string, text: string): FileVectorChunkRow {
  return chunkWithHeading(id, text, []);
}

function chunkWithHeading(id: string, text: string, headingPath: string[]): FileVectorChunkRow {
  return {
    id,
    source: {
      id: `source-${id}`,
      kind: "markdown",
      title: `${id}.md`,
      path: `${id}.md`,
      headingPath,
    },
    sourcePath: `${id}.md`,
    text,
    contentHash: `hash-${id}`,
    embeddingModel: "nomic",
    vectorOffset: 0,
    vectorLength: 2,
  };
}
