import { describe, expect, it } from "vitest";

import {
  applySubAgentTransition,
  deriveSubAgentTitle,
  isBoundToParentRun,
  readSubAgentSearchBudget,
  reduceSubAgentSourcePolicy,
  type SubAgentSessionRecord,
  type SubAgentTransition,
  validateSubAgentResources,
  validateSubAgentTaskInput,
} from "@core/research";

import {
  applyAll,
  AT,
  readySubAgentRecord,
  runToImport,
  sourcePolicy,
} from "../support/subAgentSessions";

describe("sub-agent tool input validation", () => {
  it("accepts a task of exactly 2000 characters after trimming", () => {
    expect(validateSubAgentTaskInput(`  ${"a".repeat(2_000)}  `)).toEqual({
      ok: true,
      value: "a".repeat(2_000),
    });
  });

  it("rejects a direct task over 2000 characters unless the host grants map_sources", () => {
    expect(validateSubAgentTaskInput("a".repeat(2_001))).toEqual({
      ok: false,
      code: "task-too-long",
      message: "Task must not exceed 2000 characters.",
    });
    expect(validateSubAgentTaskInput("a".repeat(8_192), "map_sources").ok).toBe(true);
    expect(validateSubAgentTaskInput("a".repeat(8_193), "map_sources").ok).toBe(false);
  });

  it("defaults, clamps and rejects search budgets and resources with stable codes", () => {
    expect(
      [undefined, 0, 99, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "3"].map((value) => {
        const result = readSubAgentSearchBudget(value);
        return result.ok ? result.value : result.code;
      }),
    ).toEqual([8, 1, 20, ...Array(4).fill("invalid-max-searches")]);
    expect(readSubAgentSearchBudget(2.5)).toMatchObject({
      message: "maxSearches must be an integer.",
    });
    expect(
      [
        undefined,
        [" a.org "],
        Array(8).fill("x".repeat(120)),
        [""],
        ["x".repeat(121)],
        Array(9).fill("a.org"),
        "a.org",
        [1],
      ].map((value) => {
        const result = validateSubAgentResources(value);
        return result.ok ? result.value : result.code;
      }),
    ).toEqual([
      [],
      ["a.org"],
      Array(8).fill("x".repeat(120)),
      ...Array(5).fill("invalid-resources"),
    ]);
    expect(validateSubAgentResources([""])).toMatchObject({
      message: "resources must be an array of at most 8 non-empty strings.",
    });
  });
});

const launch = { at: AT, callerMode: "thinking" } as const;

function followUp(runId: string, task = "Go deeper"): SubAgentTransition {
  return {
    type: "command",
    command: { type: "follow-up", task },
    origin: "direct",
    runId,
    ...launch,
  };
}

function failedRecord(): SubAgentSessionRecord {
  return applyAll(readySubAgentRecord(), [
    ...runToImport("run-1").slice(0, 2),
    { type: "provider-failed", runId: "run-1", at: AT, reason: "provider" },
  ]);
}

describe("sub-agent session transitions", () => {
  it("moves initial through import to ready and accepts a follow-up in the same session", () => {
    const imported = applyAll(readySubAgentRecord(), runToImport("run-1"));
    expect(imported.session).toMatchObject({ status: "importing", pendingImportGeneration: 1 });
    const ready = applyAll(imported, [{ type: "import-committed", generation: 1, at: AT }]);
    const next = applyAll(ready, [followUp("run-2")]);

    expect(ready.session).toMatchObject({
      status: "ready",
      revision: 4,
      contextSummary: "summary of run-1",
    });
    expect(next.session).toMatchObject({
      subAgentSessionId: "session-1",
      status: "queued",
      activeSubAgentRunId: "run-2",
      runCount: 2,
    });
    expect(
      next.runs.map((run) => [run.status, run.attempt, run.resultRevision, run.budgetScopeId]),
    ).toEqual([
      ["completed", 1, 1, "scope-1"],
      ["queued", 1, 0, "scope-1"],
    ]);
  });

  it("rejects a follow-up while importing, queued or failed with a pending import", () => {
    const importing = applyAll(readySubAgentRecord(), runToImport("run-1"));
    const queued = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 1));
    const importFailed = applyAll(importing, [{ type: "import-failed", generation: 1, at: AT }]);

    for (const record of [importing, queued, importFailed]) {
      expect(applySubAgentTransition(record, followUp("run-2"))).toEqual({
        ok: false,
        error: {
          code: "invalid-state",
          message: "Операция недоступна в текущем состоянии сессии.",
        },
      });
    }
    expect(importFailed.session).toMatchObject({
      status: "failed",
      pendingImportRunId: "run-1",
      pendingImportGeneration: 1,
    });
  });

  it("gives retry and continue-partial distinct lineage and rejects a stale terminal head", () => {
    const failed = failedRecord();
    const retried = applyAll(failed, [
      { type: "retry", retry: { runId: "run-1" }, runId: "run-2", ...launch },
    ]);
    const continued = applyAll(failed, [
      {
        type: "command",
        command: { type: "continue-partial", task: "Finish", fromRunId: "run-1" },
        origin: "direct",
        runId: "run-2",
        ...launch,
      },
    ]);
    const secondFailure = applyAll(retried, [
      { type: "execution-denied", runId: "run-2", at: AT, reason: "budget" },
    ]);

    expect(retried.runs[1]).toMatchObject({
      command: "Find X",
      attempt: 2,
      retryOfRunId: "run-1",
      continuedFromRunId: null,
    });
    expect(continued.runs[1]).toMatchObject({
      command: "Finish",
      attempt: 1,
      retryOfRunId: null,
      continuedFromRunId: "run-1",
    });
    expect(
      applySubAgentTransition(secondFailure, {
        type: "retry",
        retry: { runId: "run-1" },
        runId: "run-3",
        ...launch,
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid-state" } });
  });

  it("clears the active run, issues fresh import generations and tombstones pending imports", () => {
    const importFailed = applyAll(readySubAgentRecord(), [
      ...runToImport("run-1"),
      { type: "import-failed", generation: 1, at: AT },
    ]);
    const retry = applySubAgentTransition(importFailed, {
      type: "retry",
      retry: { runId: "run-1" },
      runId: "run-2",
      ...launch,
    });
    if (!retry.ok) throw new Error(retry.error.code);
    const reimported = applyAll(retry.record, runToImport("run-2").slice(1));
    const archived = applySubAgentTransition(importFailed, {
      type: "archive",
      reason: "parent-terminal",
      at: AT,
    });

    expect(importFailed.session.activeSubAgentRunId).toBeNull();
    expect(retry.tombstonedImport).toEqual({ runId: "run-1", generation: 1 });
    expect(retry.record.session).toMatchObject({
      pendingImportRunId: null,
      lastImportGeneration: 1,
    });
    expect(reimported.session.pendingImportGeneration).toBe(2);
    expect(
      applySubAgentTransition(reimported, { type: "import-committed", generation: 1, at: AT }).ok,
    ).toBe(false);
    expect(archived).toMatchObject({
      ok: true,
      tombstonedImport: { runId: "run-1", generation: 1 },
    });
  });

  it("lets a model stop keep retry while user archive is final and idempotent", () => {
    const running = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 2));
    const stopped = applyAll(running, [
      { type: "model-stop", runId: "run-1", at: AT, reason: "timeout" },
    ]);
    const archived = applyAll(running, [{ type: "archive", reason: "user-archive", at: AT }]);
    const again = applySubAgentTransition(archived, {
      type: "archive",
      reason: "user-archive",
      at: "later",
    });

    expect([stopped.session.status, stopped.runs[0].status]).toEqual([
      "interrupted",
      "interrupted",
    ]);
    expect(
      applySubAgentTransition(stopped, {
        type: "retry",
        retry: { runId: "run-1" },
        runId: "run-2",
        ...launch,
      }).ok,
    ).toBe(true);
    expect([archived.session.status, archived.runs[0].status]).toEqual(["archived", "interrupted"]);
    expect(again).toEqual({ ok: true, record: archived, tombstonedImport: null });
    expect(
      applySubAgentTransition(archived, {
        type: "retry",
        retry: { runId: "run-1" },
        runId: "run-2",
        ...launch,
      }).ok,
    ).toBe(false);
  });

  it("isolates sessions and refuses a second run on the same record", () => {
    const queued = applyAll(readySubAgentRecord(), runToImport("run-1").slice(0, 1));
    const other = applyAll(readySubAgentRecord("session-2"), [
      ...runToImport("run-9").slice(0, 2),
      { type: "provider-failed", runId: "run-9", at: AT, reason: "x" },
    ]);

    expect(applySubAgentTransition(queued, runToImport("run-2")[0])).toMatchObject({
      ok: false,
      error: { code: "invalid-state" },
    });
    expect(
      applySubAgentTransition(queued, { type: "scheduler-start", runId: "run-9", at: AT }).ok,
    ).toBe(false);
    expect(
      applySubAgentTransition(other, {
        type: "retry",
        retry: { runId: "run-1" },
        runId: "run-2",
        ...launch,
      }),
    ).toEqual({
      ok: false,
      error: { code: "not-authorized", message: "Нет доступа к сессии." },
    });
    expect(
      isBoundToParentRun(other.session, {
        chatSessionId: "chat-1",
        parentRunId: "parent-1",
        bindingGeneration: 2,
      }),
    ).toBe(false);
    expect(
      isBoundToParentRun(other.session, {
        chatSessionId: "chat-1",
        parentRunId: "parent-1",
        bindingGeneration: 1,
      }),
    ).toBe(true);
  });
});

describe("sub-agent source policy", () => {
  it("only narrows web, index paths and the active file, including on retry", () => {
    const denied = {
      ok: false,
      error: {
        code: "source-scope-denied",
        message: "Запрошенные источники превышают разрешённую область.",
      },
    };
    const indexOnly = sourcePolicy({
      searchMode: "indexOnly",
      contextPaths: [],
      indexScope: "none",
    });

    expect(
      reduceSubAgentSourcePolicy(sourcePolicy(), {
        searchMode: "indexOnly",
        contextPaths: ["./Research//Notes/"],
        allowActiveFile: false,
      }),
    ).toEqual({
      ok: true,
      policy: sourcePolicy({
        searchMode: "indexOnly",
        contextPaths: ["Research/Notes"],
        allowActiveFile: false,
      }),
    });
    expect(
      reduceSubAgentSourcePolicy(sourcePolicy({ indexScope: "all-allowed", contextPaths: [] }), {
        contextPaths: [],
        allowActiveFile: false,
      }),
    ).toMatchObject({
      policy: { indexScope: "none", contextPaths: [] },
    });
    expect(
      reduceSubAgentSourcePolicy(indexOnly, {
        searchMode: "webOnly",
        contextPaths: [],
        allowActiveFile: false,
      }),
    ).toEqual(denied);
    expect(
      reduceSubAgentSourcePolicy(sourcePolicy(), {
        contextPaths: ["Research/../Private"],
        allowActiveFile: false,
      }),
    ).toEqual(denied);
    expect(
      reduceSubAgentSourcePolicy(sourcePolicy(), {
        contextPaths: ["Researcher"],
        allowActiveFile: false,
      }),
    ).toEqual(denied);
    expect(
      reduceSubAgentSourcePolicy(sourcePolicy(), {
        contextPaths: [],
        allowActiveFile: true as false,
      }),
    ).toEqual(denied);

    const narrowed = applyAll(failedRecord(), [
      {
        type: "retry",
        retry: {
          runId: "run-1",
          scopeReduction: { searchMode: "webOnly", contextPaths: [], allowActiveFile: false },
        },
        runId: "run-2",
        ...launch,
      },
      { type: "execution-denied", runId: "run-2", at: AT, reason: "x" },
    ]);
    expect(
      applySubAgentTransition(narrowed, {
        type: "retry",
        retry: {
          runId: "run-2",
          scopeReduction: { searchMode: "indexOnly", contextPaths: [], allowActiveFile: false },
        },
        runId: "run-3",
        ...launch,
      }),
    ).toEqual(denied);
  });

  it("derives titles with the shared chat title policy after removing control characters", () => {
    expect(deriveSubAgentTitle(" Compare\u202E\n\tvendors ")).toBe("Compare vendors");
    expect(deriveSubAgentTitle(" \u202E\u0007 ")).toBe("Untitled sub-agent");
  });
});
