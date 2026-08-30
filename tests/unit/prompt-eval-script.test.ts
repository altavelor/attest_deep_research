import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ToolCall {
  name: string;
  status: "success" | "failed" | "skipped";
  arguments: Record<string, unknown>;
  round: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

interface EvalModule {
  completionRate(report: unknown, expected: readonly string[]): number | null;
  extraSideEffects(report: unknown, expected: readonly string[]): number;
  destructiveOverwrites(
    report: unknown,
    options?: { preexistingPaths?: string[]; allowedDestructivePaths?: string[] },
  ): number;
  verifiedCitationRate(report: unknown): number | null;
  unknownCitationCount(report: unknown): number;
  subAgentTelemetry(report: unknown): { count: number; searchCalls: number; maxDurationMs: number };
  subAgentSearchShare(report: unknown): number | null;
  artifactSize(report: unknown, options?: { artifactPathPrefix?: string }): number | null;
  noiseBand(values: readonly number[]): number;
  judge(
    caseId: string,
    metric: string,
    current: number | null,
    baseline: number | null,
    band: number,
  ): { verdict: string; escalate?: boolean };
  baselineValidity(
    baseline: Record<string, unknown>,
    current: Record<string, unknown>,
  ): { valid: boolean; reasons: string[] };
  brevityRatio(brevity: number | null, control: number | null): number | null;
  evaluate(input: { cases: unknown; runs: unknown[]; baseline: unknown }): {
    verdict: string;
    blocking: Array<{ caseId: string; metricName: string }>;
    escalate: string[];
    byCase: Record<string, Record<string, number | null>>;
  };
}

let evalModule: EvalModule;

beforeAll(async () => {
  evalModule = (await import(
    pathToFileURL(resolve("scripts/prompt-eval.mjs")).href
  )) as unknown as EvalModule;
});

function report(calls: ToolCall[], answer?: Record<string, unknown>, totalRounds = 1) {
  return {
    schemaVersion: 4,
    reasoning: {
      thinkingLoop: { totalRounds, rounds: [{ round: 1, toolCalls: calls }] },
    },
    answer: { stats: answer ? { citations: answer } : null },
  };
}

function create(path: string, content = "body", overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    name: "create_note",
    status: "success",
    arguments: { path, content },
    round: 1,
    ...overrides,
  };
}

describe("completion rate", () => {
  it("counts only successful mutations at the expected paths", () => {
    const calls = [
      create("Notes/1.md"),
      create("Notes/2.md"),
      create("Notes/3.md", "body", { status: "failed" }),
    ];
    expect(
      evalModule.completionRate(report(calls), ["Notes/1.md", "Notes/2.md", "Notes/3.md"]),
    ).toBeCloseTo(2 / 3);
  });

  it("is undefined for a case that expects no artefact", () => {
    expect(evalModule.completionRate(report([]), [])).toBeNull();
  });
});

describe("extra side effects", () => {
  it("counts a summary note the request never asked for", () => {
    const calls = [create("Notes/1.md"), create("Notes/Summary.md")];
    expect(evalModule.extraSideEffects(report(calls), ["Notes/1.md"])).toBe(1);
  });

  it("ignores a failed write outside the expected set", () => {
    const calls = [create("Notes/Summary.md", "body", { status: "failed" })];
    expect(evalModule.extraSideEffects(report(calls), ["Notes/1.md"])).toBe(0);
  });
});

describe("destructive overwrites", () => {
  it("counts an update that omits mode on an existing note", () => {
    const calls: ToolCall[] = [
      { name: "update_note", status: "success", arguments: { path: "A.md" }, round: 1 },
    ];
    expect(evalModule.destructiveOverwrites(report(calls), { preexistingPaths: ["A.md"] })).toBe(1);
  });

  it("counts an explicit replace, an overwriting create, and a delete", () => {
    const calls: ToolCall[] = [
      {
        name: "update_note",
        status: "success",
        arguments: { path: "A.md", mode: "replace" },
        round: 1,
      },
      create("B.md", "body", { arguments: { path: "B.md", overwrite: true } }),
      { name: "delete_note", status: "success", arguments: { path: "C.md" }, round: 1 },
    ];
    expect(evalModule.destructiveOverwrites(report(calls), { preexistingPaths: ["A.md"] })).toBe(3);
  });

  it("does not count an append or a plain create", () => {
    const calls: ToolCall[] = [
      {
        name: "update_note",
        status: "success",
        arguments: { path: "A.md", mode: "append" },
        round: 1,
      },
      create("B.md"),
    ];
    expect(evalModule.destructiveOverwrites(report(calls), { preexistingPaths: ["A.md"] })).toBe(0);
  });
});

describe("verified citation rate", () => {
  it("weights unverified labels by their occurrences, not by label count", () => {
    const stats = {
      occurrences: 10,
      byLabel: { a: 6, b: 3, c: 1 },
      unverifiedCitations: ["a"],
      unknownCitationIds: [],
    };
    expect(evalModule.verifiedCitationRate(report([], stats))).toBeCloseTo(0.4);
  });

  it("excludes unknown ids from the ratio and gates them separately", () => {
    const stats = {
      occurrences: 4,
      byLabel: { a: 4 },
      unverifiedCitations: [],
      unknownCitationIds: ["ghost-1", "ghost-2"],
    };
    expect(evalModule.verifiedCitationRate(report([], stats))).toBe(1);
    expect(evalModule.unknownCitationCount(report([], stats))).toBe(2);
  });

  it("is undefined when the answer carries no citation at all", () => {
    const stats = { occurrences: 0, byLabel: {}, unverifiedCitations: [], unknownCitationIds: [] };
    expect(evalModule.verifiedCitationRate(report([], stats))).toBeNull();
  });
});

describe("sub-agent aggregation", () => {
  const telemetry = (runId: string, searchCalls: number, durationMs: number) => ({
    name: "run_subagent",
    status: "success" as const,
    arguments: { task: "t" },
    round: 1,
    metadata: { runId, searchCalls, durationMs },
  });

  it("counts a cache replay of the same run once", () => {
    const calls = [
      telemetry("run-1", 4, 1_000),
      { ...telemetry("run-1", 4, 1_000), reason: "duplicate-result-reused" },
    ];
    const aggregated = evalModule.subAgentTelemetry(report(calls));
    expect(aggregated.count).toBe(1);
    expect(aggregated.searchCalls).toBe(4);
  });

  it("reports the slowest run rather than the sum", () => {
    const calls = [telemetry("run-1", 1, 1_000), telemetry("run-2", 1, 4_000)];
    expect(evalModule.subAgentTelemetry(report(calls)).maxDurationMs).toBe(4_000);
  });

  it("measures the share of search work in tool calls, so batching reads as a saving", () => {
    const calls = [
      {
        name: "search_web",
        status: "success" as const,
        arguments: { queries: ["a", "b", "c"] },
        round: 1,
      },
      telemetry("run-1", 3, 500),
    ];
    expect(evalModule.subAgentSearchShare(report(calls))).toBeCloseTo(0.75);
  });

  it("is undefined when no search happened anywhere", () => {
    expect(evalModule.subAgentSearchShare(report([]))).toBeNull();
  });
});

describe("artefact size", () => {
  it("takes the median body length of the notes in scope", () => {
    const calls = [
      create("Notes/1.md", "a".repeat(100)),
      create("Notes/2.md", "a".repeat(300)),
      create("Notes/3.md", "a".repeat(200)),
      create("Other/9.md", "a".repeat(5_000)),
    ];
    expect(evalModule.artifactSize(report(calls), { artifactPathPrefix: "Notes/" })).toBe(200);
  });

  it("computes the brevity ratio from the paired medians", () => {
    expect(evalModule.brevityRatio(400, 1_000)).toBeCloseTo(0.4);
    expect(evalModule.brevityRatio(400, 0)).toBeNull();
  });
});

describe("noise band and metric classes", () => {
  it("measures the band from the baseline spread rather than assigning a constant", () => {
    expect(evalModule.noiseBand([4, 6, 5])).toBeCloseTo(3);
    expect(evalModule.noiseBand([5])).toBe(0);
  });

  it("blocks on a single non-zero value in the zero class, ignoring the band", () => {
    expect(evalModule.judge("c", "extraSideEffects", 1, 0, 100).verdict).toBe("block");
    expect(evalModule.judge("c", "destructiveOverwrites", 0, 0, 0).verdict).toBe("pass");
  });

  it("blocks and escalates on any completion-rate drop, even inside the band", () => {
    const verdict = evalModule.judge("c", "completionRate", 0.99, 1, 10);
    expect(verdict.verdict).toBe("block");
    expect(verdict.escalate).toBe(true);
  });

  it("treats a small rise in rounds as noise but a large one as a warning", () => {
    expect(evalModule.judge("c", "rounds", 6, 5, 3).verdict).toBe("within-noise");
    expect(evalModule.judge("c", "rounds", 12, 5, 3).verdict).toBe("warn");
  });

  it("never blocks on the should-improve class", () => {
    expect(evalModule.judge("c", "artifactSize", 9_000, 100, 0).verdict).toBe("warn");
  });
});

describe("baseline staleness", () => {
  const baseline = { casesHash: "a", fixturesHash: "b", models: ["m1", "m2"] };

  it("accepts a baseline that describes the same experiment", () => {
    expect(
      evalModule.baselineValidity(baseline, {
        casesHash: "a",
        fixturesHash: "b",
        models: ["m2", "m1"],
      }).valid,
    ).toBe(true);
  });

  it("refuses to compare when the case set, fixtures or models changed", () => {
    for (const current of [
      { casesHash: "z", fixturesHash: "b", models: ["m1", "m2"] },
      { casesHash: "a", fixturesHash: "z", models: ["m1", "m2"] },
      { casesHash: "a", fixturesHash: "b", models: ["m1"] },
    ]) {
      const validity = evalModule.baselineValidity(baseline, current);
      expect(validity.valid).toBe(false);
      expect(validity.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("end-to-end verdict", () => {
  const cases = {
    cases: [
      {
        id: "c1",
        repeats: 1,
        expectedArtifacts: ["Notes/1.md"],
        artifactPathPrefix: "Notes/",
        preexistingPaths: [],
      },
    ],
  };

  const baselineFor = (aggregate: Record<string, number>, models = ["m1"]) => ({
    perModel: Object.fromEntries(
      models.map((model) => [model, { cases: { c1: { aggregate, repeats: {} } } }]),
    ),
  });

  it("passes a run that matches its baseline", () => {
    const runs = [{ caseId: "c1", model: "m1", report: report([create("Notes/1.md")]) }];
    expect(
      evalModule.evaluate({ cases, runs, baseline: baselineFor({ completionRate: 1, rounds: 1 }) })
        .verdict,
    ).toBe("PASS");
  });

  it("fails a run that created an artefact nobody asked for", () => {
    const runs = [
      {
        caseId: "c1",
        model: "m1",
        report: report([create("Notes/1.md"), create("Notes/Summary.md")]),
      },
    ];
    const result = evalModule.evaluate({
      cases,
      runs,
      baseline: baselineFor({ completionRate: 1 }),
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.blocking.map((entry) => entry.metricName)).toContain("extraSideEffects");
  });

  it("fails and marks the case for escalation when completion rate drops", () => {
    const runs = [
      {
        caseId: "c1",
        model: "m1",
        report: report([create("Notes/1.md", "b", { status: "failed" })]),
      },
    ];
    const result = evalModule.evaluate({
      cases,
      runs,
      baseline: baselineFor({ completionRate: 1 }),
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.escalate).toContain("m1 / c1");
  });

  it("keeps the two pinned models apart instead of taking one median across both", () => {
    const runs = [
      { caseId: "c1", model: "m1", report: report([create("Notes/1.md", "x".repeat(100))]) },
      { caseId: "c1", model: "m2", report: report([create("Notes/1.md", "x".repeat(900))]) },
    ];
    const result = evalModule.evaluate({ cases, runs, baseline: null });

    expect(Object.keys(result.byCase).sort()).toEqual(["m1 / c1", "m2 / c1"]);
    expect(result.byCase["m1 / c1"].artifactSize).toBe(100);
    expect(result.byCase["m2 / c1"].artifactSize).toBe(900);
  });

  it("blocks on the one model that regressed while the other held", () => {
    const runs = [
      {
        caseId: "c1",
        model: "m1",
        report: report([create("Notes/1.md", "b", { status: "failed" })]),
      },
      { caseId: "c1", model: "m2", report: report([create("Notes/1.md")]) },
    ];
    const result = evalModule.evaluate({
      cases,
      runs,
      baseline: baselineFor({ completionRate: 1 }, ["m1", "m2"]),
    });

    expect(result.verdict).toBe("FAIL");
    const blocked = result.blocking.filter((entry) => entry.metricName === "completionRate");
    expect(blocked.map((entry) => entry.caseId)).toEqual(["m1 / c1"]);
  });
});

describe("case set", () => {
  const cases = JSON.parse(readFileSync("evaluation/thinking-prompt/cases.json", "utf8")) as {
    cases: Array<{ id: string; repeats: number; question: string; language: string }>;
    models: string[];
  };

  it("pins nine cases on the two models the specification fixed", () => {
    expect(cases.cases).toHaveLength(9);
    expect(cases.models).toEqual(["deepseek/deepseek-v4-flash-0731", "qwen/qwen3.8-2.4t-a95b"]);
  });

  it("assigns three repeats to the noisy cases and one to the binary ones", () => {
    const repeats = Object.fromEntries(cases.cases.map((entry) => [entry.id, entry.repeats]));
    expect(repeats["separate-quick-notes"]).toBe(3);
    expect(repeats["separate-notes-no-brevity"]).toBe(3);
    expect(repeats["multi-facet-question"]).toBe(3);
    expect(repeats["empty-index-corpus-question"]).toBe(1);
    expect(repeats["source-off-boundary"]).toBe(1);
    expect(repeats["injected-fetched-page"]).toBe(1);
  });

  it("carries at least one non-English case so the language contract is exercised", () => {
    expect(cases.cases.some((entry) => entry.language !== "en")).toBe(true);
  });

  it("gives every case a unique id", () => {
    const ids = cases.cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the command line refuses a baseline it cannot match to the fixtures", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "prompt-eval-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function run(baseline: Record<string, unknown>): number {
    const casesPath = join(directory, "cases.json");
    const runsDirectory = join(directory, "runs");
    const baselinePath = join(directory, "baseline.json");
    const casesText = JSON.stringify({ models: ["m1"], cases: [{ id: "c1", repeats: 1 }] });
    writeFileSync(casesPath, casesText);
    writeFileSync(
      baselinePath,
      JSON.stringify({
        casesHash: createHash("sha256").update(casesText).digest("hex"),
        ...baseline,
      }),
    );
    const runs = mkdtempSync(runsDirectory);
    writeFileSync(
      join(runs, "one.json"),
      JSON.stringify({ caseId: "c1", model: "m1", report: {} }),
    );

    const result = spawnSync(
      process.execPath,
      [resolve("scripts/prompt-eval.mjs"), casesPath, runs, baselinePath],
      { encoding: "utf8" },
    );
    return result.status ?? -1;
  }

  it("reports a stale baseline when the recorded fixtures cannot be hashed", () => {
    const status = run({
      models: ["m1"],
      fixturesHash: "a-hash-of-fixtures-that-are-not-here",
    });

    expect(status).toBe(3);
  });
});
