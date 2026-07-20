import { verifyCitations } from "@application/use-cases/research/strategies/citationVerification";
import type { RetrievedChunk } from "@core/model";

function chunk(id: string, text: string, kind: "pdf" | "web" = "pdf"): RetrievedChunk {
  const source =
    kind === "web"
      ? {
          id,
          kind: "web" as const,
          title: id,
          url: `https://example.com/${id}`,
          snippet: "",
          retrievedAt: "2026-01-01T00:00:00.000Z",
          wasContentFetched: false,
        }
      : { id, kind: "pdf" as const, title: id, path: `${id}.pdf`, pageNumber: 1 };
  return { id, text, contentHash: id, score: 1, source };
}

const noUrls = { urlToEvidenceId: new Map<string, string>() };

describe("verifyCitations", () => {
  it("passes a claim whose wording overlaps the cited chunk", () => {
    const evidence = [
      chunk("e1", "The caffeine half-life in healthy adults is about five hours on average."),
    ];
    const answer = "The caffeine half-life in healthy adults is about five hours [e1].";
    expect(verifyCitations(answer, evidence, noUrls)).toEqual([]);
  });

  it("flags a claim that does not lexically overlap the cited chunk", () => {
    const evidence = [
      chunk("e1", "The document discusses medieval agricultural crop rotation techniques."),
    ];
    const answer =
      "Quarterly revenue grew by forty percent driven by strong cloud subscription sales [e1].";
    expect(verifyCitations(answer, evidence, noUrls)).toEqual(["e1"]);
  });

  it("does not flag an id when at least one occurrence is well-supported", () => {
    const evidence = [
      chunk("e1", "Photosynthesis converts sunlight into chemical energy in plants."),
    ];
    const answer =
      "Unrelated boilerplate sentence here [e1]. Photosynthesis converts sunlight into chemical energy [e1].";
    expect(verifyCitations(answer, evidence, noUrls)).toEqual([]);
  });

  it("ignores citations to unknown ids (handled as unknownCitationIds elsewhere)", () => {
    const answer = "Some claim with a dangling citation [missing].";
    expect(verifyCitations(answer, [], noUrls)).toEqual([]);
  });

  it("skips claims too short to judge", () => {
    const evidence = [
      chunk("e1", "A long chunk about quantum entanglement and Bell inequalities."),
    ];
    expect(verifyCitations("As shown [e1].", evidence, noUrls)).toEqual([]);
  });

  it("resolves [url:…] tokens through the url map before checking overlap", () => {
    const evidence = [
      chunk(
        "w1",
        "Solar panels convert photons into electricity via the photovoltaic effect.",
        "web",
      ),
    ];
    const urlToEvidenceId = new Map([["https://example.com/w1", "w1"]]);
    const good =
      "Solar panels convert photons into electricity via the photovoltaic effect [url:https://example.com/w1].";
    const bad = "The treaty was signed in 1648 ending the war [url:https://example.com/w1].";
    expect(verifyCitations(good, evidence, { urlToEvidenceId })).toEqual([]);
    expect(verifyCitations(bad, evidence, { urlToEvidenceId })).toEqual(["w1"]);
  });
});
