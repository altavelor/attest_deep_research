import { tokenizeForSearch, tokenSetForSearch } from "@core/retrieval";
import { normalizeInlineWhitespace } from "../../src/shared/whitespace";

describe("text normalization helpers", () => {
  it("normalizes inline whitespace", () => {
    expect(normalizeInlineWhitespace("  alpha\n\n beta\tgamma  ")).toBe("alpha beta gamma");
  });

  it("tokenizes search text with unicode letters and digits", () => {
    expect(tokenizeForSearch("Local-first модель v2", { minLength: 2 })).toEqual([
      "local",
      "first",
      "модель",
      "v2",
    ]);
  });

  it("builds a search token set with a minimum token length", () => {
    expect(Array.from(tokenSetForSearch("AI local local web", { minLength: 3 }))).toEqual([
      "local",
      "web",
    ]);
  });
});
