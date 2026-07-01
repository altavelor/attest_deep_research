import { rankSectionsByQuery, splitIntoSections } from "@core/web/sectionRanking";

describe("rankSectionsByQuery", () => {
  const text =
    "Cats are small carnivorous mammals. They are kept as pets worldwide. " +
    "Dogs are loyal companions. Dogs descend from wolves and hunt in packs. " +
    "Photosynthesis converts light into energy. Plants rely on chlorophyll.";

  it("returns only sections overlapping the query, ranked then ordered by position", () => {
    const sections = rankSectionsByQuery(text, "dogs wolves packs", {
      sentencesPerSection: 2,
      limit: 5,
    });

    expect(sections.length).toBe(1);
    expect(sections[0]?.text).toContain("Dogs descend from wolves");
    expect(sections[0]?.score).toBeGreaterThan(0);
  });

  it("preserves reading order among the selected sections", () => {
    const sections = rankSectionsByQuery(text, "cats dogs", {
      sentencesPerSection: 2,
      limit: 5,
    });
    const indices = sections.map((section) => section.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("falls back to leading sections (score 0) when the query has no usable terms", () => {
    const sections = rankSectionsByQuery(text, "a of", { sentencesPerSection: 2, limit: 2 });
    expect(sections.length).toBe(2);
    expect(sections.every((section) => section.score === 0)).toBe(true);
    expect(sections[0]?.index).toBe(0);
  });

  it("returns nothing for empty text", () => {
    expect(rankSectionsByQuery("", "anything")).toEqual([]);
  });
});

describe("splitIntoSections", () => {
  it("groups sentences into fixed-size windows", () => {
    const sections = splitIntoSections("One. Two. Three. Four. Five.", 2);
    expect(sections).toEqual(["One. Two.", "Three. Four.", "Five."]);
  });
});
