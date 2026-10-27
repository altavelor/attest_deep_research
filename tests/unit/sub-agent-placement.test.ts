import { describe, expect, it } from "vitest";

import {
  interleaveWorkflowEvents,
  placeSubAgentEvents,
  subAgentRunStatus,
  type ParentTimelineEvent,
} from "@core/chat/subAgentPlacement";
import { stampChainSequences } from "@core/chat/chainItemSequence";
import { normalizeSubAgentTimeline } from "@core/chat/subAgentTimeline";
import { parentDisplayChain, type ChainItem, type ChatDisplayMessage } from "@core/conversation";
import type { SubAgentNoticeEntry } from "@core/research";

function notice(
  kind: SubAgentNoticeEntry["kind"],
  sequence: number,
  runId: string | null = "r1",
): SubAgentNoticeEntry {
  return {
    eventKey: `notice:${kind}:${sequence}`,
    parentRunId: "p1",
    description: `${kind} title`,
    createdAt: "t",
    sessionId: "s1",
    runId,
    sequence,
    kind,
  };
}

const dispatch = {
  eventKey: "dispatch:p1:s1:r1",
  sessionId: "s1",
  runId: "r1",
  parentRunId: "p1",
  body: "Task",
  createdAt: "t",
  commandKind: "initial" as const,
  attempt: 1,
  sequence: 4,
};

function tool(id: string, timelineSequence?: number, extra: Partial<ChainItem> = {}): ChainItem {
  return {
    kind: "tool-call",
    id,
    name: "search_web",
    label: id,
    status: "complete",
    ...(timelineSequence === undefined ? {} : { timelineSequence }),
    ...extra,
  } as ChainItem;
}

function assistant(id: string, chain: ChainItem[]): ChatDisplayMessage {
  return {
    id,
    role: "assistant",
    content: "",
    createdAt: "t",
    researchProgress: {
      phase: "streaming",
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "idle", segments: [] },
      checkpoints: [],
      chain,
    },
  };
}

const ids = (entries: ReturnType<typeof interleaveWorkflowEvents>) =>
  entries.map((entry) =>
    entry.type === "item"
      ? ((entry.item as { id?: string; segmentId?: string }).id ?? "reasoning")
      : entry.event.sequence,
  );

describe("sub-agent run status", () => {
  it("prefers the latest terminal notice, then a queued notice of the same run, then running", () => {
    expect(subAgentRunStatus(dispatch, [])).toBe("running");
    expect(subAgentRunStatus(dispatch, [notice("created", 3), notice("queued", 5, "other")])).toBe(
      "running",
    );
    expect(
      subAgentRunStatus({ ...dispatch, runId: "r2" }, [
        notice("queued", 5),
        notice("queued", 6, null),
      ]),
    ).toBe("running");
    expect(subAgentRunStatus(dispatch, [notice("queued", 5)])).toBe("queued");
    expect(
      subAgentRunStatus(dispatch, [
        notice("queued", 5),
        notice("partial", 7),
        notice("finished", 9),
        notice("failed", 6),
        notice("closed", 10),
      ]),
    ).toBe("finished");
  });
});

describe("placing sub-agent events", () => {
  it("puts events of a rendered run inside its answer and keeps the rest as orphans", () => {
    const placement = placeSubAgentEvents(
      [assistant("answer-p1", [])],
      [dispatch, { ...dispatch, eventKey: "dispatch:lost", parentRunId: "gone" }],
      [notice("finished", 9), notice("created", 3), notice("finished", 9)],
    );
    expect(
      placement.byMessageId.get("answer-p1")!.map((event) => [event.kind, event.sequence]),
    ).toEqual([
      ["agent-notice", 3],
      ["agent-dispatch", 4],
      ["agent-notice", 9],
    ]);
    const placed = placement.byMessageId.get("answer-p1")![1] as Extract<
      ParentTimelineEvent,
      { kind: "agent-dispatch" }
    >;
    expect([placed.title, placed.status]).toEqual(["created title", "finished"]);
    expect(placement.orphanDispatches.map((entry) => entry.eventKey)).toEqual(["dispatch:lost"]);
    expect(placement.orphanNotices).toEqual([]);
  });

  it("flushes earlier events before each sequenced item, hidden anchors included, and the rest at the end", () => {
    const events = [9, 2, 5, 7].map((sequence) => ({
      kind: "agent-notice" as const,
      sequence,
      notice: notice("created", sequence),
    }));
    const chain: ChainItem[] = [
      { kind: "reasoning", segmentId: "r", content: "x" },
      tool("legacy"),
      tool("a", 3),
      tool("b", 5),
      tool("wait", 6, { name: "wait_subagents" }),
      { kind: "reasoning", segmentId: "late", content: "y" },
    ];
    expect(ids(interleaveWorkflowEvents(chain, events))).toEqual([
      "reasoning",
      "legacy",
      2,
      "a",
      "b",
      5,
      "reasoning",
      7,
      9,
    ]);
  });
});

describe("chain item sequences", () => {
  it("stamps new top-level items, sequences the message and raises the allocator above them", () => {
    const state = {
      messages: [
        assistant("answer-p1", [tool("a", 4), { kind: "reasoning", segmentId: "r", content: "x" }]),
      ],
      subAgentDispatches: [],
      subAgentNotices: [],
      timelineSequence: 2,
    };
    const stamped = stampChainSequences(state, "answer-p1")!;
    const chain = stamped.messages[0]!.researchProgress!.chain;
    expect([
      stamped.messages[0]!.timelineSequence,
      chain.map((item) => item.timelineSequence),
      stamped.timelineSequence,
    ]).toEqual([1, [4, 5], 6]);
    expect(stampChainSequences(stamped, "answer-p1")).toBeNull();
    expect(stampChainSequences(state, "answer-other")).toBeNull();
  });

  it("drops an unusable saved sequence and keeps the allocator above valid ones", () => {
    const normalized = normalizeSubAgentTimeline({
      messages: [
        assistant("m", [
          tool("bad", -1),
          tool("big", 1.5),
          { kind: "reasoning", segmentId: "ok", content: "x", timelineSequence: 8 },
        ]),
      ],
      subAgentDispatches: [],
      subAgentNotices: [],
      timelineSequence: 0,
    });
    expect(
      normalized.messages[0]!.researchProgress!.chain.map((item) => "timelineSequence" in item),
    ).toEqual([false, false, true]);
    expect(normalized.timelineSequence).toBe(9);
  });
});

describe("parent display chain", () => {
  it("hides sub-agent tool rows unless they failed", () => {
    const chain = [
      tool("own"),
      tool("run", 1, { name: "run_subagent" }),
      tool("wait", 2, { name: "wait_subagents", status: "pending" }),
      tool("result", 3, { name: "get_subagent_result" }),
      tool("rejected", 4, { name: "run_subagent", status: "failed" }),
      tool("map", 5, { name: "map_sources" }),
    ];
    expect(parentDisplayChain(chain).map((item) => (item as { id: string }).id)).toEqual([
      "own",
      "rejected",
      "map",
    ]);
  });
});
