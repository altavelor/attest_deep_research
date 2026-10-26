import { describe, expect, it } from "vitest";

import { toSubAgentWorkflowModel } from "@apps/obsidian/ui/chat/workflow";
import type { SubAgentWorkflowItem } from "@core/research";

function item(overrides: Partial<SubAgentWorkflowItem>): SubAgentWorkflowItem {
  return {
    id: "call",
    sessionId: "session-1",
    runId: "run-1",
    name: "search_web",
    label: "Search the web",
    sequence: 0,
    round: 1,
    status: "complete",
    startedAt: "2026-01-01T00:00:00.000Z",
    payloadState: "disabled",
    ...overrides,
  };
}

describe("sub-agent workflow model", () => {
  it("keeps ids, sequence order, statuses and the safe badge without any reasoning", () => {
    const model = toSubAgentWorkflowModel(
      "session-1",
      [
        item({ id: "late", sequence: 2, status: "failed", runId: "run-2", round: 2 }),
        item({ id: "early", sequence: 1, status: "pending", badge: { text: "partial" } }),
      ],
      "streaming",
    );

    expect(model.scopeId).toBe("sub-agent:session-1");
    expect(model.phase).toBe("streaming");
    expect(model.reasoningSegments).toEqual([]);
    expect(model.checkpoints).toEqual([]);
    expect(model.items).toEqual([
      {
        kind: "tool-call",
        id: "early",
        name: "search_web",
        label: "Search the web",
        status: "pending",
        badge: { text: "partial" },
        attempt: { runId: "run-1", round: 1 },
      },
      {
        kind: "tool-call",
        id: "late",
        name: "search_web",
        label: "Search the web",
        status: "failed",
        attempt: { runId: "run-2", round: 2 },
      },
    ]);
  });
});
