import { describe, expect, it } from "vitest";

import {
  applySubAgentTimelineEvent,
  type SubAgentTimelineState,
} from "@core/chat/subAgentTimeline";

function batchEvent(done: number, failed: number) {
  return {
    type: "notice" as const,
    entry: {
      eventKey: "notice:chat:p1:-:-:batch",
      parentRunId: "p1",
      description: "Map",
      createdAt: "t",
      sessionId: null,
      runId: null,
      kind: "batch" as const,
      batchId: "b1",
      batch: { total: 6, done, failed, running: 6 - done - failed },
    },
  };
}

describe("applySubAgentTimelineEvent", () => {
  it("replaces a batch notice in place only with no fewer settled children", () => {
    const empty: SubAgentTimelineState = {
      messages: [],
      subAgentDispatches: [],
      subAgentNotices: [],
      timelineSequence: 3,
    };
    const first = applySubAgentTimelineEvent(empty, batchEvent(4, 1))!;
    const stale = applySubAgentTimelineEvent(first, batchEvent(1, 0));
    const newer = applySubAgentTimelineEvent(first, batchEvent(5, 1))!;

    expect(stale).toBeNull();
    expect(applySubAgentTimelineEvent(first, batchEvent(5, 0))).not.toBeNull();
    expect(newer.subAgentNotices.map((notice) => [notice.sequence, notice.batch?.done])).toEqual([
      [3, 5],
    ]);
  });
});
