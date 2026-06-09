import {
  buildKeywordPostingRows,
  rankKeywordPostings,
  tokenizeForKeywordIndex,
} from "../../src/indexing/LightweightKeywordIndex";
import { FileVectorChunkRow } from "../../src/indexing/FileVectorIndexStore";

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

    expect(rankKeywordPostings("local retrieval", rows, 3, 3)).toEqual([
      { chunkId: "chunk-a", score: 3 },
      { chunkId: "chunk-b", score: 1 },
    ]);
  });

  it("returns no matches for empty or too-short queries", () => {
    const rows = buildKeywordPostingRows([chunk("chunk-a", "local model")], 3);

    expect(rankKeywordPostings("to be", rows, 3, 5)).toEqual([]);
    expect(rankKeywordPostings("local", rows, 3, 0)).toEqual([]);
  });
});

function chunk(id: string, text: string): FileVectorChunkRow {
  return {
    id,
    source: {
      id: `source-${id}`,
      kind: "markdown",
      title: `${id}.md`,
      path: `${id}.md`,
      headingPath: [],
    },
    sourcePath: `${id}.md`,
    text,
    contentHash: `hash-${id}`,
    embeddingModel: "nomic",
    vectorOffset: 0,
    vectorLength: 2,
  };
}
