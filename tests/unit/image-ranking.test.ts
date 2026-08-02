import { describe, expect, it } from "vitest";

import {
  queryTerms,
  rankImageCandidates,
  RELEVANCE_CUTOFF,
  scoreImageCandidate,
  type ImageCandidate,
} from "@core/media";

const candidate = (id: string, overrides: Partial<ImageCandidate> = {}): ImageCandidate => ({
  id,
  origin: "provider",
  fullUrl: `https://cdn.example.com/${id}.jpg`,
  alt: id,
  sourceUrl: `https://example.com/page/${id}`,
  sourceLabel: "example.com",
  width: 900,
  height: 700,
  ...overrides,
});

describe("candidate scoring", () => {
  const terms = queryTerms("solar system diagram");

  it("rewards matching text over a non-matching candidate", () => {
    const match = candidate("a", { alt: "Solar system diagram in true colour" });
    const unrelated = candidate("b", { alt: "A red fox in snow" });
    expect(scoreImageCandidate(match, terms)).toBeGreaterThan(
      scoreImageCandidate(unrelated, terms),
    );
  });

  it("matches terms in the file name as well as the caption", () => {
    const byName = candidate("c", {
      alt: "",
      fullUrl: "https://cdn.example.com/Solar_System_diagram.png",
    });
    expect(scoreImageCandidate(byName, terms)).toBeGreaterThan(
      scoreImageCandidate(candidate("d", { alt: "" }), terms),
    );
  });

  it("prefers licensed provider images over bare page references", () => {
    const licensed = candidate("e", { licensed: true, licenceName: "CC BY 4.0" });
    const page = candidate("f", { origin: "page" });
    expect(scoreImageCandidate(licensed, terms)).toBeGreaterThan(scoreImageCandidate(page, terms));
  });

  it("penalises tiny images, extreme aspect ratios and boilerplate names", () => {
    const base = candidate("g", { alt: "solar system diagram" });
    expect(scoreImageCandidate({ ...base, width: 60, height: 40 }, terms)).toBeLessThan(
      scoreImageCandidate(base, terms),
    );
    expect(scoreImageCandidate({ ...base, width: 1600, height: 90 }, terms)).toBeLessThan(
      scoreImageCandidate(base, terms),
    );
    expect(
      scoreImageCandidate({ ...base, fullUrl: "https://cdn.example.com/site-logo.png" }, terms),
    ).toBeLessThan(scoreImageCandidate(base, terms));
  });

  it("ranks a vault document image above an equally matching web one", () => {
    const vault = candidate("h", {
      origin: "document",
      alt: "solar system diagram",
      fullUrl: undefined,
      vaultSource: { documentPath: "notes/astro.md", locator: "file" },
    });
    const web = candidate("i", { alt: "solar system diagram" });
    expect(scoreImageCandidate(vault, terms)).toBeGreaterThan(scoreImageCandidate(web, terms));
  });
});

describe("ranking and relevance cutoff", () => {
  it("orders by relevance rather than provider order", () => {
    const ranked = rankImageCandidates(
      [
        candidate("weak", { alt: "unrelated picture" }),
        candidate("strong", { alt: "solar system diagram of the planets" }),
      ],
      "solar system diagram",
      10,
    );
    expect(ranked[0]!.id).toBe("strong");
  });

  it("cuts the irrelevant tail instead of padding up to the limit", () => {
    const ranked = rankImageCandidates(
      [
        candidate("hit-1", { alt: "solar system diagram" }),
        candidate("hit-2", { alt: "solar system diagram of planets" }),
        candidate("miss-1", { alt: "kitchen recipe" }),
        candidate("miss-2", { alt: "office building" }),
      ],
      "solar system diagram",
      10,
    );
    expect(ranked.map((item) => item.id)).toEqual(["hit-1", "hit-2"]);
  });

  it("keeps the whole field when every candidate scores alike", () => {
    const ranked = rankImageCandidates(
      [candidate("a"), candidate("b"), candidate("c")],
      "нерелевантный запрос",
      10,
    );
    expect(ranked).toHaveLength(3);
  });

  it("caps at the requested limit", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      candidate(`n${index}`, { alt: "solar system diagram" }),
    );
    expect(rankImageCandidates(many, "solar system diagram", 12)).toHaveLength(12);
  });

  it("drops the same picture reached through two resources", () => {
    const ranked = rankImageCandidates(
      [
        candidate("commons", { fullUrl: "https://cdn.example.com/Photo.jpg" }),
        candidate("brave", { fullUrl: "https://cdn.example.com/Photo.jpg" }),
      ],
      "photo",
      10,
    );
    expect(ranked).toHaveLength(1);
  });

  it("never returns junk that matches nothing, even as the only candidate", () => {
    const junk = candidate("j", {
      alt: "site logo",
      fullUrl: "https://cdn.example.com/logo.png",
      width: 40,
      height: 40,
    });
    expect(scoreImageCandidate(junk, queryTerms("solar system diagram"))).toBeLessThan(
      RELEVANCE_CUTOFF.absolute,
    );
    expect(rankImageCandidates([junk], "solar system diagram", 10)).toEqual([]);
  });

  it("returns nothing for an empty field", () => {
    expect(rankImageCandidates([], "anything", 10)).toEqual([]);
  });
});
