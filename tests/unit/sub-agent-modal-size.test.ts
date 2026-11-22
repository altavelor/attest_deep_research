import { describe, expect, it } from "vitest";

import {
  clampSize,
  keyboardResize,
  parsePersistedSize,
  sizeBounds,
} from "@apps/obsidian/ui/chat/sub-agents/modalSize";

const bounds = sizeBounds({ width: 1024, height: 768 });

describe("sub-agent modal size rules", () => {
  it("keeps a viewport margin and lets a tiny viewport win over the minimum", () => {
    expect(bounds).toEqual({ minWidth: 352, minHeight: 320, maxWidth: 992, maxHeight: 736 });
    expect(sizeBounds({ width: 300, height: 200 })).toEqual({
      minWidth: 268,
      minHeight: 168,
      maxWidth: 268,
      maxHeight: 168,
    });
  });

  it("clamps on both sides of each limit", () => {
    expect(clampSize({ width: 351.6, height: 319 }, bounds)).toEqual({ width: 352, height: 320 });
    expect(clampSize({ width: 993, height: 737 }, bounds)).toEqual({ width: 992, height: 736 });
    expect(clampSize({ width: 353, height: 735 }, bounds)).toEqual({ width: 353, height: 735 });
  });

  it("maps arrow keys per handle axis and ignores other keys", () => {
    const current = { width: 500, height: 400 };
    expect(keyboardResize("ArrowRight", false, "x", current)).toEqual({ width: 516, height: 400 });
    expect(keyboardResize("ArrowUp", true, "both", current)).toEqual({ width: 500, height: 336 });
    expect(keyboardResize("ArrowDown", false, "x", current)).toBeNull();
    expect(keyboardResize("ArrowLeft", false, "y", current)).toBeNull();
    expect(keyboardResize("Enter", false, "both", current)).toBeNull();
  });

  it("rejects malformed persisted sizes and clamps stale ones", () => {
    for (const raw of [
      null,
      "640",
      { width: Number.NaN, height: 400 },
      { width: 400, height: -1 },
      { width: 400, height: 0 },
      { width: Infinity, height: 400 },
      { width: "400", height: 400 },
    ]) {
      expect(parsePersistedSize(raw, bounds)).toBeNull();
    }
    expect(parsePersistedSize({ width: 1e9, height: 1 }, bounds)).toEqual({
      width: 992,
      height: 320,
    });
  });
});
