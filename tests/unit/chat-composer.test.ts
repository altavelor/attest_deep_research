import { getMentionCandidates } from "../../src/apps/obsidian/ui/chat/mentionAutocomplete";
import { nextHorizontalWheelScrollLeft } from "../../src/apps/obsidian/ui/chat/horizontalWheelScroll";
import { isSupportedContextDocumentPath } from "../../src/shared/pathFilters";

describe("chat composer", () => {
  it("offers context documents for an @ query", () => {
    expect(getMentionCandidates("cache", ["Concepts/Cache.md", "Notes/Other.md"])).toEqual([
      {
        insertText: "Concepts/Cache.md",
        label: "Concepts/Cache.md",
        detail: "Document",
      },
    ]);
  });

  it("supports .md, .pdf, .txt and other document types as context", () => {
    expect(isSupportedContextDocumentPath("Notes/Research.md")).toBe(true);
    expect(isSupportedContextDocumentPath("Docs/Paper.pdf")).toBe(true);
    expect(isSupportedContextDocumentPath("Notes/image.png")).toBe(false);
  });

  it("maps vertical wheel movement to horizontal attachment carousel scrolling", () => {
    expect(
      nextHorizontalWheelScrollLeft({
        clientWidth: 100,
        scrollWidth: 400,
        scrollLeft: 50,
        deltaX: 0,
        deltaY: 80,
        deltaMode: 0,
      }),
    ).toBe(130);
  });

  it("does not intercept wheel scrolling when the carousel cannot move further", () => {
    expect(
      nextHorizontalWheelScrollLeft({
        clientWidth: 100,
        scrollWidth: 100,
        scrollLeft: 0,
        deltaX: 0,
        deltaY: 80,
        deltaMode: 0,
      }),
    ).toBeNull();

    expect(
      nextHorizontalWheelScrollLeft({
        clientWidth: 100,
        scrollWidth: 400,
        scrollLeft: 300,
        deltaX: 0,
        deltaY: 80,
        deltaMode: 0,
      }),
    ).toBeNull();
  });
});
