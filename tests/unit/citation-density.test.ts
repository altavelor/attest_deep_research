import { describe, expect, it } from "vitest";
import { normalizeCitationDensity } from "@core/research";

describe("normalizeCitationDensity", () => {
  it("collapses duplicate known labels within one citation group", () => {
    const labels = new Set(["source-a"]);

    expect(normalizeCitationDensity("Claim [source-a][source-a][source-a].", labels)).toBe(
      "Claim [source-a].",
    );
  });

  it("keeps the first repeated label in adjacent sentences and resets at a paragraph boundary", () => {
    const labels = new Set(["source-a"]);
    const answer =
      "First claim [source-a]. Second claim [source-a]. Third claim [source-a].\n\nFourth claim [source-a].";

    expect(normalizeCitationDensity(answer, labels)).toBe(
      "First claim [source-a]. Second claim. Third claim.\n\nFourth claim [source-a].",
    );
  });

  it("recognizes CJK sentence boundaries", () => {
    expect(normalizeCitationDensity("甲 [source-a]。乙 [source-a]。", new Set(["source-a"]))).toBe(
      "甲 [source-a]。乙。",
    );
  });

  it("preserves the last occurrence of every label when the default sentence cap cannot be met", () => {
    const labels = new Set(["source-a", "source-b", "source-c", "source-d"]);
    const answer = "Claim [source-a][source-b][source-c][source-d].";

    expect(normalizeCitationDensity(answer, labels)).toBe(answer);
  });

  it("enforces the default maximum of three labels when an excess label occurs later", () => {
    const labels = new Set(["source-a", "source-b", "source-c", "source-d"]);

    expect(
      normalizeCitationDensity(
        "Combined claim [source-a][source-b][source-c][source-d]. Later detail [source-d].",
        labels,
      ),
    ).toBe("Combined claim [source-a][source-b][source-c]. Later detail [source-d].");
  });

  it("supports a lower per-sentence maximum without deleting a label's final occurrence", () => {
    const labels = new Set(["source-a", "source-b", "source-c"]);

    expect(
      normalizeCitationDensity(
        "Combined claim [source-a][source-b][source-c]. Later detail [source-c].",
        labels,
        { maxLabelsPerSentence: 2 },
      ),
    ).toBe("Combined claim [source-a][source-b]. Later detail [source-c].");
  });

  it("leaves markdown links, images, and ordinary bracketed prose unchanged", () => {
    const labels = new Set(["source-a"]);
    const answer =
      "Read [source-a](https://example.com/docs), view ![source-a](image.png), keep [source-a][docs], and keep [ordinary prose]. Claim [source-a][source-a].";

    expect(normalizeCitationDensity(answer, labels)).toBe(
      "Read [source-a](https://example.com/docs), view ![source-a](image.png), keep [source-a][docs], and keep [ordinary prose]. Claim [source-a].",
    );
  });

  it("leaves repeated known citation ids inside inline and fenced code unchanged", () => {
    const answer = [
      "Use `[source-a][source-a]` as an example.",
      "",
      "```text",
      "[source-a][source-a]",
      "```",
      "",
      "Claim [source-a][source-a].",
    ].join("\n");

    expect(normalizeCitationDensity(answer, new Set(["source-a"]))).toBe(
      answer.replace("Claim [source-a][source-a].", "Claim [source-a]."),
    );
  });

  it("does not count a known label used as a Markdown reference id as a citation", () => {
    const labels = new Set(["source-a", "source-b"]);
    const answer = [
      "Read [guide][source-a]. Claim [source-b][source-b].",
      "",
      "[source-a]: https://example.com/guide",
    ].join("\n");

    expect(normalizeCitationDensity(answer, labels)).toBe(
      [
        "Read [guide][source-a]. Claim [source-b].",
        "",
        "[source-a]: https://example.com/guide",
      ].join("\n"),
    );
  });

  it("preserves a full Markdown reference link whose text and known reference id match", () => {
    const labels = new Set(["source-a"]);
    const answer = ["Read [source-a][source-a].", "", "[source-a]: https://example.com/guide"].join(
      "\n",
    );

    expect(normalizeCitationDensity(answer, labels)).toBe(answer);
  });

  it("only changes labels present in the whitelist", () => {
    const labels = new Set(["source-a"]);

    expect(
      normalizeCitationDensity("Known [source-a][source-a]. Unknown [source-x][source-x].", labels),
    ).toBe("Known [source-a]. Unknown [source-x][source-x].");
  });

  it("returns text without citations byte-for-byte unchanged", () => {
    const answer = "  Plain answer with [ordinary prose].\n\n- Exact spacing stays.  \n";

    expect(normalizeCitationDensity(answer, new Set(["source-a"]))).toBe(answer);
  });
});
