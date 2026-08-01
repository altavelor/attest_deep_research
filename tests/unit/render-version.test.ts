import { RenderVersionTracker } from "@apps/obsidian/ui/chat/renderVersion";

describe("RenderVersionTracker", () => {
  it("invalidates an older render when a newer render begins", () => {
    const tracker = new RenderVersionTracker();
    const firstRender = tracker.next();
    const secondRender = tracker.next();

    expect(tracker.isCurrent(secondRender)).toBe(true);
    expect(tracker.isCurrent(firstRender)).toBe(false);
  });
});
