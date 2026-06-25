import { RepetitionDetector } from "../../src/client/chat/repetitionDetector";

function feed(detector: RepetitionDetector, text: string): void {
  // Feed in small fragments to mimic token-by-token streaming.
  for (const ch of text) detector.push(ch);
}

describe("RepetitionDetector", () => {
  it("does not flag normal varied prose", () => {
    const detector = new RepetitionDetector();
    feed(
      detector,
      "Wikipedia began as Nupedia.\nIt was slow to produce articles.\n" +
      "The wiki model launched in 2001.\nGrowth was rapid and global.\n",
    );
    expect(detector.isRepeating()).toBe(false);
  });

  it("flags a single line repeated many times", () => {
    const detector = new RepetitionDetector();
    feed(detector, "Actually, I'll do the chapter notes first.\n".repeat(5));
    expect(detector.isRepeating()).toBe(true);
  });

  it("flags an alternating two-line block (the observed gemma loop)", () => {
    const detector = new RepetitionDetector();
    feed(
      detector,
      (
        "Wait, I'll check if I can use create_note for all at once? No, one by one.\n" +
        "Actually, I'll do the chapter notes first.\n"
      ).repeat(5),
    );
    expect(detector.isRepeating()).toBe(true);
  });

  it("does not flag short repeated separators", () => {
    const detector = new RepetitionDetector();
    feed(detector, "---\n".repeat(6));
    expect(detector.isRepeating()).toBe(false);
  });
});
