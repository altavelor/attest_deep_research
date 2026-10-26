import { describe, expect, it } from "vitest";

import { parseSavedChat } from "@core/chat/savedChat";
import {
  evictSubAgentDetails,
  recoverSubAgentState,
  validateSubAgentState,
  type SubAgentObservationRecord,
  type SubAgentStateSnapshot,
} from "@core/research";
import { subAgentSection, DOCUMENT_CHAT_SETTINGS } from "../support/chatDocuments";
import { applyAll, readySubAgentRecord, runToImport } from "../support/subAgentSessions";

const LATER = "2026-10-27T08:00:00.000Z";

function withRun(snapshot: SubAgentStateSnapshot, mutate: (run: Record<string, unknown>) => void) {
  const record = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 1));
  const run = { ...record.runs[0] } as Record<string, unknown>;
  mutate(run);
  return { ...snapshot, records: [{ ...record, runs: [run] }] } as unknown as SubAgentStateSnapshot;
}

function detail(observationId: string, runId: string, text: string, cited = false) {
  return {
    kind: "tool-end",
    observationId,
    sessionId: "session-1",
    runId,
    cited,
    payload: text,
  } satisfies SubAgentObservationRecord;
}

describe("sub-agent section validation", () => {
  it("keeps a corrupt section verbatim as unreadable while the chat stays readable", () => {
    const section = { version: 1, chatId: "chat-1", revision: -1 };
    const chat = parseSavedChat({
      schemaVersion: 4,
      id: "chat-1",
      title: "Chat",
      createdAt: LATER,
      updatedAt: LATER,
      messages: [{ role: "user", content: "Still here", createdAt: LATER }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: DOCUMENT_CHAT_SETTINGS,
      subAgents: section,
    });

    expect(chat?.messages[0]?.content).toBe("Still here");
    expect(chat?.subAgents).toEqual({
      status: "unreadable",
      raw: section,
      reason: "Sub-agent state has an invalid field: revision.",
    });
  });

  it.each([
    [
      "an unknown version",
      { ...subAgentSection(), version: 2 },
      "unsupported-state-version",
      "Sub-agent state has an unsupported version.",
    ],
    [
      "a traversal session id",
      subAgentSection([{ ...readySubAgentRecord("../escape") }]),
      "invalid-state-field",
      "Sub-agent state has an invalid field: records[0].session.subAgentSessionId.",
    ],
    [
      "a run of another session",
      withRun(subAgentSection(), (run) => (run.subAgentSessionId = "other")),
      "invalid-state-field",
      "Sub-agent state has an invalid field: records[0].runs[0].subAgentSessionId.",
    ],
    [
      "a non-finite usage counter",
      withRun(
        subAgentSection(),
        (run) => (run.usage = { ...(run.usage as object), toolCalls: Infinity }),
      ),
      "invalid-state-field",
      "Sub-agent state has an invalid field: records[0].runs[0].usage.toolCalls.",
    ],
    [
      "an unknown import discriminant",
      subAgentSection([], { imports: [{ state: "applied" }] as never }),
      "invalid-state-field",
      "Sub-agent state has an invalid field: imports[0].state.",
    ],
  ])("rejects %s with its code and message", (_name, value, code, message) => {
    expect(validateSubAgentState(value)).toEqual({ ok: false, code, message });
  });
});

describe("recoverSubAgentState", () => {
  it("interrupts live runs, archives sessions and records a marker without binding", () => {
    const live = applyAll(readySubAgentRecord("live"), runToImport("run-live").slice(0, 2));
    const done = {
      ...readySubAgentRecord("done"),
      session: { ...readySubAgentRecord("done").session, status: "archived" as const },
    };
    const snapshot = subAgentSection([live, done]);

    const recovered = recoverSubAgentState(snapshot, LATER);

    expect(recovered.revision).toBe(2);
    expect(recovered.records[1]).toBe(done);
    expect(recovered.records[0]?.session).toMatchObject({
      status: "archived",
      activeSubAgentRunId: null,
      parentRunId: "parent-1",
      bindingGeneration: 1,
    });
    expect(recovered.records[0]?.runs[0]).toMatchObject({
      status: "interrupted",
      terminalReason: "crash-recovery",
      completedAt: LATER,
    });
    expect(recovered.recoveryMarkers).toEqual([
      {
        parentRunId: "parent-1",
        terminalReason: "crash-recovery",
        createdAt: LATER,
        fencedRunIds: ["run-live"],
        cancelledImports: [],
        unresolvedActionKeys: [],
      },
    ]);
    expect(recoverSubAgentState(recovered, LATER)).toBe(recovered);
  });
});

describe("evictSubAgentDetails", () => {
  const old = withRun(subAgentSection(), (run) => {
    run.status = "completed";
    run.completedAt = "2026-10-26T10:01:00.000Z";
  });

  it("keeps details exactly at the budget", () => {
    const snapshot = { ...old, observation: [detail("o1", "run-1", "abcd")] };

    expect(evictSubAgentDetails(snapshot, 6)).toEqual({ snapshot, withinBudget: true });
  });

  it("evicts uncited details of the oldest terminal run above the budget and keeps the rest", () => {
    const live = applyAll(readySubAgentRecord("live"), runToImport("run-live").slice(0, 2));
    const snapshot = {
      ...old,
      records: [...old.records, live],
      observation: [
        detail("o1", "run-1", "abcd"),
        detail("o2", "run-1", "cited", true),
        detail("o3", "run-live", "live"),
      ],
    };

    const { snapshot: evicted, withinBudget } = evictSubAgentDetails(snapshot, 13);

    expect(withinBudget).toBe(true);
    expect(evicted.observation).toEqual([
      { ...detail("o1", "run-1", "abcd"), payload: null, evicted: { reason: "chat size limit" } },
      detail("o2", "run-1", "cited", true),
      detail("o3", "run-live", "live"),
    ]);
    expect(evicted.records).toBe(snapshot.records);
  });
});
