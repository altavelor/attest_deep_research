import { clamp } from "@core/clamp";

describe("clamp", () => {
  it("returns the minimum when the value is below the range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it("returns the value when it is within the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});
