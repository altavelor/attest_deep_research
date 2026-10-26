import { describe, expect, it } from "vitest";

import { parseSavedChat } from "@core/chat/savedChat";
import {
  applySubAgentDelta,
  checkSubAgentDelta,
  evictSubAgentDetails,
  recoverSubAgentState,
  validateSubAgentState,
  type SubAgentObservationRecord,
  type SubAgentStateSnapshot,
} from "@core/research";
import { subAgentSection, DOCUMENT_CHAT_SETTINGS } from "../support/chatDocuments";
import {
  applyAll,
  batchRecord,
  readySubAgentRecord,
  runToImport,
} from "../support/subAgentSessions";

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
  it("keeps a corrupt section verbatim as unreadable and rejects dangling references", () => {
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

    const imported = {
      state: "prepared",
      importId: "import-1",
      chatId: "chat-1",
      sessionId: "session-1",
      runId: "run-1",
      evidenceDigest: "digest",
      generation: 1,
      evidence: [],
      aliases: [],
      answerText: "",
      createdAt: LATER,
    } as const;
    const action = {
      state: "prepared",
      actionKey: "action-1",
      sessionId: "session-1",
      runId: "run-1",
      attempt: 1,
      action: "search",
      ordinal: 0,
      fenceGeneration: 1,
    } as const;
    const linked = {
      ...withRun(subAgentSection(), () => undefined),
      imports: [imported],
      pendingActions: [action],
      batches: [batchRecord()],
    };
    const fieldOf = (value: unknown) =>
      (validateSubAgentState(value) as { message?: string }).message ?? "valid";

    expect(fieldOf(linked)).toBe("valid");
    expect(
      [
        { ...linked, imports: [{ ...imported, chatId: "chat-2" }] },
        { ...linked, imports: [{ ...imported, sessionId: "session-9" }] },
        { ...linked, pendingActions: [{ ...action, runId: "run-9" }] },
        {
          ...linked,
          batches: [
            batchRecord({
              refs: [{ sourcePath: "Notes/a.md", ref: { sessionId: "session-1", runId: "run-9" } }],
            }),
          ],
        },
        { ...linked, batches: [batchRecord({ error: { code: "x", message: "e".repeat(501) } })] },
      ].map(fieldOf),
    ).toEqual([
      "Sub-agent state has an invalid field: imports[0].chatId.",
      "Sub-agent state has an invalid field: imports[0].sessionId.",
      "Sub-agent state has an invalid field: pendingActions[0].runId.",
      "Sub-agent state has an invalid field: batches[0].refs[0].ref.",
      "Sub-agent state has an invalid field: batches[0].error.",
    ]);
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

  it("refuses deltas outside the allow-list and drops batches of a deleted session", () => {
    expect(
      checkSubAgentDelta({ op: "set", entity: "session", id: "s", fields: { apiKey: "x" } }),
    ).toBe("Field apiKey is not allowed for session");
    expect(checkSubAgentDelta({ op: "set", entity: "batch", id: "b", fields: { rows: [] } })).toBe(
      "Field rows is not allowed for batch",
    );
    const linked = { ...withRun(subAgentSection(), () => undefined), batches: [batchRecord()] };
    expect(
      applySubAgentDelta(linked, { op: "delete", entity: "session", id: "session-1" })?.batches,
    ).toEqual([]);
    expect(
      applySubAgentDelta(subAgentSection([]), {
        op: "set",
        entity: "run",
        id: "run-9",
        fields: { subAgentSessionId: "missing" },
      }),
    ).toBeNull();
  });
});

describe("recoverSubAgentState", () => {
  it("interrupts live runs, archives sessions and records a marker without binding", () => {
    const live = applyAll(readySubAgentRecord("live"), runToImport("run-live").slice(0, 2));
    const done = {
      ...readySubAgentRecord("done"),
      session: { ...readySubAgentRecord("done").session, status: "archived" as const },
    };
    const finished = batchRecord({ batchId: "batch-0", refs: [], state: "failed" });
    const snapshot = subAgentSection([live, done], {
      batches: [finished, batchRecord({ refs: [], state: "preparing" })],
    });

    const recovered = recoverSubAgentState(snapshot, LATER);

    expect(recovered.batches).toEqual([
      finished,
      batchRecord({
        refs: [],
        state: "interrupted",
        error: {
          code: "crash-recovery",
          message: "The batch was interrupted when the app restarted.",
        },
      }),
    ]);
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
    const row = {
      sourcePath: "Notes/a.md",
      ok: true,
      stance: "supports",
      keyFindings: ["A long finding [e-1]"],
      evidenceIds: ["e-1"],
    };
    const result = {
      question: "Does X hold?",
      rows: [row],
      diagnostics: { selection: "explicit" as const, requested: 1, completed: 1, failed: 0 },
    };
    const snapshot = {
      ...old,
      records: [...old.records, live],
      observation: [
        detail("o1", "run-1", "abcd"),
        detail("o2", "run-1", "cited", true),
        detail("o3", "run-live", "live"),
      ],
      batches: [batchRecord({ state: "completed", result })],
    };

    const { snapshot: evicted, withinBudget } = evictSubAgentDetails(snapshot, 13);

    expect(withinBudget).toBe(true);
    expect(evicted.batches?.[0]?.result?.rows).toEqual([
      { ...row, keyFindings: ["[evicted: chat size limit]"] },
    ]);
    expect(evicted.observation).toEqual([
      { ...detail("o1", "run-1", "abcd"), payload: null, evicted: { reason: "chat size limit" } },
      detail("o2", "run-1", "cited", true),
      detail("o3", "run-live", "live"),
    ]);
    expect(evicted.records).toBe(snapshot.records);
  });
});
