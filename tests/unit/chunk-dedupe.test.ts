import { dedupeNearDuplicateChunks } from "@core/retrieval";
import type { RetrievedChunk } from "@core/model";

function chunk(id: string, path: string, text: string, score: number): RetrievedChunk {
  return {
    id,
    text,
    contentHash: id,
    score,
    source: { id: path, kind: "pdf", title: path, path, pageNumber: 1 },
  };
}

const PASSAGE =
  "The photovoltaic effect converts incident sunlight into a direct electric current " +
  "through semiconductor junctions, and this conversion efficiency depends strongly on " +
  "temperature and spectral distribution of the incoming light across the panel surface.";

describe("dedupeNearDuplicateChunks", () => {
  it("suppresses a near-duplicate copy from another source and annotates the survivor", () => {
    const nearCopy = PASSAGE.replace("across the panel surface", "over the panel surface");
    const result = dedupeNearDuplicateChunks([
      chunk("a", "paper-a.pdf", PASSAGE, 0.9),
      chunk("b", "paper-b.pdf", nearCopy, 0.8),
    ]);

    expect(result.map((c) => c.id)).toEqual(["a"]);
    expect(result[0].duplicates).toEqual(["paper-b.pdf"]);
  });

  it("keeps genuinely distinct chunks and leaves them unannotated", () => {
    const result = dedupeNearDuplicateChunks([
      chunk("a", "a.pdf", PASSAGE, 0.9),
      chunk(
        "b",
        "b.pdf",
        "Medieval crop rotation alternated legumes with cereals to restore soil nitrogen.",
        0.8,
      ),
    ]);

    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result[0].duplicates).toBeUndefined();
    expect(result[1].duplicates).toBeUndefined();
  });

  it("keeps the highest-scored representative (input is score-ordered) and lists all copies", () => {
    const result = dedupeNearDuplicateChunks([
      chunk("a", "a.pdf", PASSAGE, 0.95),
      chunk("b", "b.pdf", PASSAGE, 0.9),
      chunk("c", "c.pdf", PASSAGE, 0.85),
    ]);

    expect(result.map((c) => c.id)).toEqual(["a"]);
    expect(result[0].duplicates).toEqual(["b.pdf", "c.pdf"]);
  });

  it("does not list the same source path twice as its own duplicate", () => {
    const result = dedupeNearDuplicateChunks([
      chunk("a1", "a.pdf", PASSAGE, 0.9),
      chunk("a2", "a.pdf", PASSAGE, 0.85),
    ]);

    expect(result.map((c) => c.id)).toEqual(["a1"]);
    expect(result[0].duplicates).toBeUndefined();
  });
});
