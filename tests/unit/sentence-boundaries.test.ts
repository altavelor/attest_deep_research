import { splitSentences } from "@core/web/sentenceBoundaries";

describe("splitSentences", () => {
  it("preserves punctuation while splitting on sentence whitespace", () => {
    expect(splitSentences("First sentence. Second one!\nThird? Final fragment")).toEqual([
      "First sentence.",
      "Second one!",
      "Third?",
      "Final fragment",
    ]);
  });

  it("does not split punctuation that is not followed by whitespace", () => {
    expect(splitSentences("Version 1.2 is current. Next sentence.")).toEqual([
      "Version 1.2 is current.",
      "Next sentence.",
    ]);
  });
});
