import { nextHorizontalWheelScrollLeft } from "../../src/ui/horizontalWheelScroll";

describe("chat composer", () => {
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
