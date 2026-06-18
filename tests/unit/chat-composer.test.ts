import { nextHorizontalWheelScrollLeft } from "../../src/ui/horizontalWheelScroll";
import { isSupportedContextDocumentPath } from "../../src/shared/pathFilters";

describe("chat composer", () => {
  it("does not offer internal skill files as context documents", () => {
    expect(isSupportedContextDocumentPath("Notes/Research.md")).toBe(true);
    expect(isSupportedContextDocumentPath(".ixplorer/skills/rag-debugger/SKILL.md")).toBe(false);
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
