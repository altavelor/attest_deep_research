import { findInText, pageOutline, readRange } from "@core/web";

const filler = "lorem ipsum dolor sit amet. ".repeat(60);

function loneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("page search", () => {
  it("ranks windows by distinct query terms and returns non-overlapping offsets", () => {
    const text = `${filler}The quick fox crossed the river bank. ${filler}Only the river here. ${filler}`;

    const matches = findInText(text, "quick river", "keywords", 100);

    expect(matches.map((match) => match.score)).toEqual([2, 1]);
    const [best, other] = matches;
    expect(text.slice(best!.offset, best!.offset + best!.length)).toContain("quick fox");
    expect(text.slice(other!.offset, other!.offset + other!.length)).toContain("Only the river");
    expect(best!.offset + best!.length).toBeLessThanOrEqual(other!.offset);
  });

  it("matches a literal phrase case-insensitively in reading order and nothing for a short query", () => {
    const text = `${filler}Fox jumped here. ${filler}fox only. ${filler}FOX JUMPED again. ${filler}`;

    const matches = findInText(text, "fox jumped", "literal", 50);

    const slices = matches.map((match) => text.slice(match.offset, match.offset + match.length));
    expect(slices).toHaveLength(2);
    expect(slices[0]).toContain("Fox jumped");
    expect(slices[1]).toContain("FOX JUMPED");
    expect(findInText(text, "x", "literal", 50)).toEqual([]);
  });

  it("reads a range on word edges, never inside a surrogate pair, and reports where to continue", () => {
    const text = `${"word ".repeat(40)}😀😀😀 ${"tail ".repeat(100)}`;
    const emoji = text.indexOf("😀");

    const inside = readRange(text, emoji + 1, 300);
    const end = readRange(text, text.length - 20, 4_000);

    expect(loneSurrogate(inside.text)).toBe(false);
    expect(inside.nextOffset).toBe(inside.offset + inside.length);
    expect([end.nextOffset, end.offset + end.length]).toEqual([null, text.length]);
    expect(text.slice(0, inside.offset).endsWith(" ") || inside.offset === 0).toBe(true);
  });

  it("lists heading-like lines in reading order and thins them across the text", () => {
    const text = [
      "# Title",
      "A sentence that is not a heading.",
      "Article 53",
      "1. Scope",
      "Chapter V rules",
      "plain line",
    ].join("\n");

    expect(pageOutline(text, 10).map((entry) => entry.title)).toEqual([
      "# Title",
      "Article 53",
      "1. Scope",
      "Chapter V rules",
    ]);
    expect(pageOutline(text, 2).map((entry) => entry.title)).toEqual(["# Title", "1. Scope"]);
  });
});
