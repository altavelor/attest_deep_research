import { formatIndexSize } from "../../src/adapters/indexing/indexSize";

describe("index size formatting", () => {
  it("formats bytes using compact binary units", () => {
    expect(formatIndexSize(0)).toBe("0 B");
    expect(formatIndexSize(42)).toBe("42 B");
    expect(formatIndexSize(42 * 1024)).toBe("42 KB");
    expect(formatIndexSize(18.5 * 1024 * 1024)).toBe("18.5 MB");
  });

  it("degrades gracefully when size cannot be measured", () => {
    expect(formatIndexSize(null)).toBe("Unavailable");
    expect(formatIndexSize(undefined)).toBe("Unavailable");
  });
});
