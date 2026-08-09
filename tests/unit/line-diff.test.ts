import { describe, expect, it } from "vitest";

import { computeLineDiff, diffHasChanges } from "@apps/obsidian/ui/shared/lineDiff";

describe("computeLineDiff", () => {
  it("keeps a small amount of surrounding context for an inline replacement", () => {
    const hunks = computeLineDiff("one\ntwo\nthree\nfour", "one\nsecond\nthree\nfour");

    expect(hunks).toEqual([
      {
        lines: [
          { type: "context", text: "one" },
          { type: "remove", text: "two" },
          { type: "add", text: "second" },
          { type: "context", text: "three" },
          { type: "context", text: "four" },
        ],
      },
    ]);
    expect(diffHasChanges(hunks)).toBe(true);
  });

  it("creates separate hunks for distant edits and handles line additions/removals", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");
    const after = ["a", "B", "c", "d", "e", "f", "g", "h", "I", "j", "new"].join("\n");
    const hunks = computeLineDiff(before, after);

    expect(hunks).toHaveLength(2);
    expect(hunks[0].lines).toContainEqual({ type: "remove", text: "b" });
    expect(hunks[0].lines).toContainEqual({ type: "add", text: "B" });
    expect(hunks[1].lines).toEqual(
      expect.arrayContaining([
        { type: "remove", text: "i" },
        { type: "add", text: "I" },
        { type: "add", text: "new" },
      ]),
    );
  });

  it("treats equal and empty text as unchanged while normalizing Windows line endings", () => {
    expect(computeLineDiff("", "")).toEqual([]);
    expect(diffHasChanges(computeLineDiff("same", "same"))).toBe(false);
    expect(computeLineDiff("one\r\ntwo", "one\ntwo\nthree")).toEqual([
      {
        lines: [
          { type: "context", text: "one" },
          { type: "context", text: "two" },
          { type: "add", text: "three" },
        ],
      },
    ]);
  });
});
