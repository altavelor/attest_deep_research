import { describe, expect, it } from "vitest";

import { parseSavedChat, parseSavedChatSubAgents } from "@core/chat/savedChat";
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
  it("rejects malformed saved prompts while retaining valid and evicted observations", () => {
    const prompt = {
      runId: "run-1",
      capturedAt: LATER,
      state: "captured",
      messages: [{ role: "user", content: "" }],
      redacted: false,
      truncated: false,
    };
    const observation = {
      kind: "model-started",
      observationId: "model:run-1",
      sessionId: "session-1",
      runId: "run-1",
      cited: false,
      payload: { prompt },
    };
    const state = withRun(subAgentSection(), () => undefined);
    const validate = (entry: unknown) => validateSubAgentState({ ...state, observation: [entry] });
    expect(validate(observation).ok).toBe(true);
    expect(
      validate({ ...observation, payload: null, evicted: { reason: "chat size limit" } }).ok,
    ).toBe(true);
    for (const [malformed, field] of [
      [null, ""],
      [{ ...prompt, runId: "../run" }, ".runId"],
      [{ ...prompt, runId: "run-2" }, ".runId"],
      [{ ...prompt, capturedAt: "yesterday" }, ".capturedAt"],
      [{ ...prompt, state: "unknown" }, ".state"],
      [{ ...prompt, redacted: "false" }, ".redacted"],
      [{ ...prompt, truncated: null }, ".truncated"],
      [{ ...prompt, unavailableReason: {} }, ".unavailableReason"],
      [{ ...prompt, messages: null }, ".messages"],
      [{ ...prompt, messages: [null] }, ".messages[0]"],
      [{ ...prompt, messages: [{ role: "user", content: {} }] }, ".messages[0].content"],
      [{ ...prompt, messages: [{ role: "unknown", content: "text" }] }, ".messages[0].role"],
    ] as const) {
      expect(validate({ ...observation, payload: { prompt: malformed } })).toMatchObject({
        ok: false,
        code: "invalid-state-field",
        message: `Sub-agent state has an invalid field: observation[0].payload.prompt${field}.`,
      });
    }
    const corrupt = {
      ...state,
      observation: [{ ...observation, payload: { prompt: { state: "captured", messages: null } } }],
    };
    expect(parseSavedChatSubAgents(corrupt, state.chatId)).toMatchObject({
      status: "unreadable",
      raw: corrupt,
    });
  });

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
    const row = {
      sourcePath: "Notes/a.md",
      ok: true,
      stance: "supports",
      keyFindings: [],
      evidenceIds: [],
    };
    const result = {
      question: "q",
      rows: [row],
      diagnostics: { selection: "explicit", requested: 1, completed: 1, failed: 0 },
    };
    const completed = (rows: unknown[], extra = {}) =>
      batchRecord({ state: "completed", result: { ...result, rows, ...extra } as never });
    const ref = { sessionId: "session-1", runId: "run-1" };
    const batchField = (batches: unknown) =>
      fieldOf({ ...linked, batches })
        .replace("Sub-agent state has an invalid field: ", "")
        .replace(/\.$/u, "");
    expect(
      [
        "x",
        [null],
        [batchRecord(), batchRecord()],
        [batchRecord({ requestId: "../x" })],
        [batchRecord({ question: "" })],
        [batchRecord({ createdAt: "yesterday" })],
        [batchRecord({ selection: "random" as never })],
        [batchRecord({ sourcePaths: ["Notes/a.md", "Notes/a.md"] })],
        [batchRecord({ refs: "none" as never })],
        [batchRecord({ refs: [{ sourcePath: "Notes/b.md", ref }] })],
        [
          batchRecord({
            sourcePaths: ["Notes/a.md", "Notes/b.md"],
            refs: [
              { sourcePath: "Notes/a.md", ref },
              { sourcePath: "Notes/a.md", ref },
            ],
          }),
        ],
        [batchRecord({ refs: [{ sourcePath: "Notes/a.md", ref: { ...ref, sessionId: "../" } }] })],
        [batchRecord({ state: "done" as never })],
        [batchRecord({ result: result as never })],
        [completed([{ ...row, stance: "s".repeat(33) }])],
        [completed([{ ...row, evidenceIds: ["../x"] }])],
        [completed([row], { diagnostics: {} })],
        [batchRecord({ error: { code: "Bad Code", message: "m" } })],
        [completed(Array.from({ length: 21 }, () => row))],
        [completed([{ ...row, keyFindings: ["f".repeat(401)] }])],
        [
          completed([
            ...Array.from({ length: 19 }, () => row),
            { ...row, keyFindings: ["f".repeat(400)], error: "provider-failed: m" },
          ]),
        ],
      ].map(batchField),
    ).toEqual([
      "batches",
      "batches[0]",
      "batches[1].batchId",
      "batches[0].requestId",
      "batches[0].question",
      "batches[0].createdAt",
      "batches[0].selection",
      "batches[0].sourcePaths",
      "batches[0].refs",
      "batches[0].refs[0]",
      "batches[0].refs[1]",
      "batches[0].refs[0].ref",
      "batches[0].state",
      "batches[0].result",
      "batches[0].result",
      "batches[0].result",
      "batches[0].result",
      "batches[0].error",
      "batches[0].result",
      "batches[0].result",
      "valid",
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
      "an unknown session origin",
      (() => {
        const section = subAgentSection();
        const [record] = section.records;
        return {
          ...section,
          records: [{ ...record, session: { ...record.session, origin: "plugin" } }],
        } as unknown as SubAgentStateSnapshot;
      })(),
      "invalid-state-field",
      "Sub-agent state has an invalid field: records[0].session.origin.",
    ],
    [
      "a negative cached token counter",
      withRun(
        subAgentSection(),
        (run) => (run.usage = { ...(run.usage as object), cachedInputTokens: -1 }),
      ),
      "invalid-state-field",
      "Sub-agent state has an invalid field: records[0].runs[0].usage.cachedInputTokens.",
    ],
    [
      "a fractional cache creation counter",
      withRun(
        subAgentSection(),
        (run) => (run.usage = { ...(run.usage as object), cacheCreationInputTokens: 1.5 }),
      ),
      "invalid-state-field",
      "Sub-agent state has an invalid field: records[0].runs[0].usage.cacheCreationInputTokens.",
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
    const { batchId, ...record } = batchRecord({ batchId: "batch-2" });
    const fields = record as unknown as Readonly<Record<string, never>>;
    const every = { ...fields, result: {} as never, error: {} as never };
    expect(
      checkSubAgentDelta({ op: "set", entity: "batch", id: batchId, fields: every }),
    ).toBeNull();
    expect(
      applySubAgentDelta(linked, { op: "set", entity: "batch", id: batchId, fields })?.batches,
    ).toHaveLength(2);
    const foreignRef = [{ sourcePath: "Notes/a.md", ref: { sessionId: "session-1", runId: "x" } }];
    expect(
      applySubAgentDelta(linked, {
        op: "set",
        entity: "batch",
        id: batchId,
        fields: { ...fields, refs: foreignRef as never },
      }),
    ).toBeNull();
    expect(
      [
        applySubAgentDelta(linked, { op: "delete", entity: "session", id: "session-1" }),
        applySubAgentDelta(linked, { op: "delete", entity: "run", id: "run-1" }),
      ].map((next) => next?.batches),
    ).toEqual([[], []]);
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
  it("interrupts live runs, keeps sessions continuable and records a marker without binding", () => {
    const live = applyAll(readySubAgentRecord("live"), runToImport("run-live").slice(0, 2));
    const done = readySubAgentRecord("done");
    const finished = batchRecord({ batchId: "batch-0", refs: [], state: "failed" });
    const snapshot = subAgentSection([live, done], {
      batches: [
        finished,
        batchRecord({ refs: [], state: "preparing" }),
        batchRecord({ batchId: "batch-2", refs: [], state: "pending" }),
      ],
    });

    const recovered = recoverSubAgentState(snapshot, LATER);

    const interrupted = {
      refs: [],
      state: "interrupted" as const,
      error: {
        code: "crash-recovery",
        message: "The batch was interrupted when the app restarted.",
      },
    };
    expect(recovered.batches).toEqual([
      finished,
      batchRecord(interrupted),
      batchRecord({ ...interrupted, batchId: "batch-2" }),
    ]);
    const batchesOnly = subAgentSection([done], { batches: [batchRecord({ refs: [] })] });
    expect(recoverSubAgentState(batchesOnly, LATER).revision).toBe(batchesOnly.revision + 1);
    expect(recovered.revision).toBe(2);
    expect(recovered.records[1]).toBe(done);
    expect(recovered.records[0]?.session).toMatchObject({
      status: "interrupted",
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

  it("measures details in UTF-8 bytes and keeps them exactly at the budget", () => {
    const snapshot = { ...old, observation: [detail("o1", "run-1", "абвг")] };

    expect(evictSubAgentDetails(snapshot, 10)).toEqual({ snapshot, withinBudget: true });
    expect(evictSubAgentDetails(snapshot, 9).snapshot.observation[0]).toMatchObject({
      payload: null,
    });
  });

  it("evicts the earliest completed terminal run first, whatever its record order", () => {
    const [record] = old.records;
    const newer = {
      ...record,
      session: { ...record.session, subAgentSessionId: "session-2" },
      runs: [
        { ...record.runs[0], subAgentRunId: "run-new", completedAt: "2026-10-26T10:05:00.000Z" },
      ],
    };
    const snapshot = {
      ...old,
      records: [newer, record],
      observation: [detail("n1", "run-new", "abcd"), detail("o1", "run-1", "abcd")],
    };

    const evicted = evictSubAgentDetails(snapshot, 6).snapshot.observation;

    expect(evicted.map((entry) => entry.payload)).toEqual(["abcd", null]);
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

    const newer = batchRecord({
      batchId: "batch-new",
      createdAt: "2026-10-26T11:00:00.000Z",
      state: "completed",
      result,
    });
    const older = { ...newer, batchId: "batch-old", createdAt: "2026-10-26T09:00:00.000Z" };
    const two = evictSubAgentDetails({ ...old, batches: [newer, older] }, 30).snapshot;
    expect(two.batches?.map((batch) => batch.result?.rows[0]?.keyFindings)).toEqual([
      row.keyFindings,
      ["[evicted: chat size limit]"],
    ]);
  });
});
