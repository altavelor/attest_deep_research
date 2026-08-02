import { labelResearchEvidence, rewriteCitationLabels } from "@core/research";
import type { RetrievedChunk } from "@core/model";

function chunk(id: string, text = "text"): RetrievedChunk {
  return {
    id,
    text,
    contentHash: id,
    score: 1,
    source: { id, kind: "pdf", title: id, path: `${id}.pdf`, pageNumber: 1 },
  };
}

describe("labelResearchEvidence", () => {
  it("numbers sections sequentially in render order (explicit, graph, retrieved, web)", () => {
    const labeled = labelResearchEvidence({
      evidence: [],
      explicitEvidence: [chunk("e1")],
      graphEvidence: [chunk("g1")],
      retrievedEvidence: [chunk("r1")],
      webEvidence: [chunk("w1")],
      maxEvidenceItems: 5,
    });

    expect(labeled.explicit.map((item) => item.label)).toEqual(["S1"]);
    expect(labeled.graph.map((item) => item.label)).toEqual(["S2"]);
    expect(labeled.retrieved.map((item) => item.label)).toEqual(["S3"]);
    expect(labeled.web.map((item) => item.label)).toEqual(["S4"]);
    expect(labeled.byLabel.get("S1")).toBe("e1");
    expect(labeled.byLabel.get("S4")).toBe("w1");
  });

  it("labels a source shared across sections once, on its highest-priority occurrence", () => {
    const shared = chunk("shared");
    const labeled = labelResearchEvidence({
      evidence: [],
      explicitEvidence: [shared],
      retrievedEvidence: [shared, chunk("r1")],
      webEvidence: [shared],
      maxEvidenceItems: 5,
    });

    expect(labeled.explicit.map((item) => item.label)).toEqual(["S1"]);

    expect(labeled.retrieved.map((item) => item.chunk.id)).toEqual(["r1"]);
    expect(labeled.web).toEqual([]);
    expect(labeled.byLabel.get("S1")).toBe("shared");
  });

  it("falls back to `evidence` for the retrieved section and respects the item cap", () => {
    const labeled = labelResearchEvidence({
      evidence: [chunk("r1"), chunk("r2"), chunk("r3")],
      maxEvidenceItems: 2,
    });

    expect(labeled.retrieved.map((item) => item.label)).toEqual(["S1", "S2"]);
    expect(labeled.byLabel.has("S3")).toBe(false);
  });
});

describe("rewriteCitationLabels", () => {
  const byLabel = new Map([
    ["S1", "chunk-aaaa"],
    ["S2", "chunk-bbbb"],
  ]);

  it("expands known labels to their chunk ids and collects cited ids", () => {
    const result = rewriteCitationLabels("Water boils at 100C [S1].", byLabel);
    expect(result.text).toBe("Water boils at 100C [chunk-aaaa].");
    expect([...result.citedChunkIds]).toEqual(["chunk-aaaa"]);
    expect(result.unknownLabels).toEqual([]);
  });

  it("expands a grouped bracket into consecutive id tokens", () => {
    const result = rewriteCitationLabels("Both agree [S1, S2].", byLabel);
    expect(result.text).toBe("Both agree [chunk-aaaa][chunk-bbbb].");
    expect([...result.citedChunkIds].sort()).toEqual(["chunk-aaaa", "chunk-bbbb"]);
  });

  it("drops unknown labels and reports them", () => {
    const result = rewriteCitationLabels("Invented [S9].", byLabel);
    expect(result.text).toBe("Invented .");
    expect(result.citedChunkIds.size).toBe(0);
    expect(result.unknownLabels).toEqual(["S9"]);
  });

  it("leaves non-label brackets untouched", () => {
    const result = rewriteCitationLabels("See [note.md] and [chunk-aaaa].", byLabel);
    expect(result.text).toBe("See [note.md] and [chunk-aaaa].");
    expect(result.citedChunkIds.size).toBe(0);
  });
});
