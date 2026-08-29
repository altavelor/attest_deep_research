#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MUTATION_TOOLS = new Set(["create_note", "update_note", "delete_note"]);
const SUB_AGENT_TOOL = "run_subagent";
const SEARCH_TOOLS = new Set(["search_web", "search_index"]);
const DUPLICATE_REASON = "duplicate-result-reused";

const METRIC_CLASSES = {
  completionRate: "must-not-degrade",
  extraSideEffects: "must-be-zero",
  destructiveOverwrites: "must-be-zero",
  verifiedCitationRate: "must-not-degrade",
  unknownCitationCount: "must-be-zero",
  rounds: "should-improve",
  subAgents: "should-improve",
  subAgentSearchShare: "should-improve",
  artifactSize: "should-improve",
};

const NOISE_BAND_FACTOR = 1.5;

/** Every tool call the report recorded, in round order, cache replays included. */
export function toolCallsOf(report) {
  const rounds = report?.reasoning?.thinkingLoop?.rounds;
  if (Array.isArray(rounds)) return rounds.flatMap((round) => round.toolCalls ?? []);
  return Array.isArray(report?.toolCalls) ? report.toolCalls : [];
}

function argumentPath(call) {
  const path = call?.arguments?.path;
  return typeof path === "string" ? path : null;
}

/** Share of the case's expected artefacts that a successful mutation call produced. */
export function completionRate(report, expectedArtifacts) {
  if (!Array.isArray(expectedArtifacts) || expectedArtifacts.length === 0) return null;
  const written = new Set(
    toolCallsOf(report)
      .filter((call) => MUTATION_TOOLS.has(call.name) && call.status === "success")
      .map(argumentPath)
      .filter((path) => path !== null),
  );
  const matched = expectedArtifacts.filter((path) => written.has(path)).length;
  return matched / expectedArtifacts.length;
}

/** Successful mutations at paths the case never asked for. */
export function extraSideEffects(report, expectedArtifacts) {
  const expected = new Set(expectedArtifacts ?? []);
  return toolCallsOf(report).filter((call) => {
    if (!MUTATION_TOOLS.has(call.name) || call.status !== "success") return false;
    const path = argumentPath(call);
    return path !== null && !expected.has(path);
  }).length;
}

/**
 * Calls that can destroy existing content: an overwriting create, any delete, and an
 * update in replace mode — including an update that omits `mode`, because replace is
 * the schema default and is the most likely path to data loss.
 */
export function destructiveOverwrites(report, options = {}) {
  const preexisting = new Set(options.preexistingPaths ?? []);
  const allowed = new Set(options.allowedDestructivePaths ?? []);
  return toolCallsOf(report).filter((call) => {
    const path = argumentPath(call);
    if (path !== null && allowed.has(path)) return false;
    if (call.name === "delete_note") return true;
    if (call.name === "create_note") return call.arguments?.overwrite === true;
    if (call.name !== "update_note") return false;
    const mode = call.arguments?.mode;
    const replaces = mode === undefined || mode === "replace";
    return replaces && (path === null || preexisting.has(path));
  }).length;
}

/**
 * Occurrence-weighted share of citations that survived verification. Unknown ids are
 * excluded on purpose: they are removed from the text before counting and are gated by
 * their own metric. Returns null when there are no occurrences to divide by.
 */
export function verifiedCitationRate(report) {
  const citations = report?.answer?.stats?.citations;
  const occurrences = citations?.occurrences;
  if (typeof occurrences !== "number" || occurrences === 0) return null;
  const byLabel = citations.byLabel ?? {};
  const unverified = citations.unverifiedCitations ?? [];
  const unverifiedOccurrences = unverified.reduce(
    (total, label) => total + (byLabel[label] ?? 0),
    0,
  );
  return (occurrences - unverifiedOccurrences) / occurrences;
}

export function unknownCitationCount(report) {
  const ids = report?.answer?.stats?.citations?.unknownCitationIds;
  return Array.isArray(ids) ? ids.length : 0;
}

export function rounds(report) {
  const total = report?.reasoning?.thinkingLoop?.totalRounds;
  return typeof total === "number" ? total : null;
}

/**
 * Sub-agent telemetry aggregated by unique `runId`, so a cache replay of the same call
 * is counted once. Records tagged as a reused duplicate are skipped as well.
 */
export function subAgentTelemetry(report) {
  const byRunId = new Map();
  for (const call of toolCallsOf(report)) {
    if (call.name !== SUB_AGENT_TOOL) continue;
    if (call.reason === DUPLICATE_REASON) continue;
    const telemetry = call.metadata;
    const runId = telemetry?.runId;
    if (typeof runId !== "string") continue;
    if (!byRunId.has(runId)) byRunId.set(runId, telemetry);
  }
  const records = [...byRunId.values()];
  return {
    count: records.length,
    searchCalls: records.reduce((total, entry) => total + (entry.searchCalls ?? 0), 0),
    totalDurationMs: records.reduce((total, entry) => total + (entry.durationMs ?? 0), 0),
    maxDurationMs: records.reduce((max, entry) => Math.max(max, entry.durationMs ?? 0), 0),
  };
}

/** Search calls the orchestrator itself issued, excluding cache replays. */
export function topLevelSearchCalls(report) {
  return toolCallsOf(report).filter(
    (call) => SEARCH_TOOLS.has(call.name) && call.reason !== DUPLICATE_REASON,
  ).length;
}

/**
 * Share of search work done inside sub-agents, counted in tool calls rather than
 * queries so that batching a call reads as a saving, not a regression.
 */
export function subAgentSearchShare(report) {
  const inside = subAgentTelemetry(report).searchCalls;
  const denominator = topLevelSearchCalls(report) + inside;
  return denominator === 0 ? null : inside / denominator;
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Median character length of the note bodies the run actually wrote. */
export function artifactSize(report, options = {}) {
  const prefix = options.artifactPathPrefix;
  const lengths = toolCallsOf(report)
    .filter((call) => call.name === "create_note" && call.status === "success")
    .filter((call) => {
      const path = argumentPath(call);
      return prefix === undefined || (path !== null && path.startsWith(prefix));
    })
    .map((call) =>
      typeof call.arguments?.content === "string" ? call.arguments.content.length : 0,
    )
    .filter((length) => length > 0);
  return median(lengths);
}

export function metricsForReport(report, testCase) {
  const telemetry = subAgentTelemetry(report);
  return {
    completionRate: completionRate(report, testCase.expectedArtifacts),
    extraSideEffects: extraSideEffects(report, testCase.expectedArtifacts),
    destructiveOverwrites: destructiveOverwrites(report, testCase),
    verifiedCitationRate: verifiedCitationRate(report),
    unknownCitationCount: unknownCitationCount(report),
    rounds: rounds(report),
    subAgents: telemetry.count,
    subAgentSearchShare: subAgentSearchShare(report),
    artifactSize: artifactSize(report, testCase),
  };
}

/** Collapses the repeats of one case into a single value per metric. */
export function aggregateRepeats(metricsList) {
  const aggregate = {};
  for (const name of Object.keys(METRIC_CLASSES)) {
    const values = metricsList
      .map((metrics) => metrics[name])
      .filter((value) => typeof value === "number");
    if (values.length === 0) {
      aggregate[name] = null;
      continue;
    }
    aggregate[name] =
      METRIC_CLASSES[name] === "must-be-zero" ? Math.max(...values) : (median(values) ?? null);
  }
  return aggregate;
}

/**
 * Noise band of one case × metric pair: the spread across baseline repeats, widened by
 * a constant factor. Measured rather than assigned, so it tracks the model in use.
 */
export function noiseBand(baselineValues) {
  const values = baselineValues.filter((value) => typeof value === "number");
  if (values.length < 2) return 0;
  return (Math.max(...values) - Math.min(...values)) * NOISE_BAND_FACTOR;
}

const HIGHER_IS_BETTER = new Set(["completionRate", "verifiedCitationRate"]);
const LOWER_IS_BETTER = new Set([
  "rounds",
  "subAgents",
  "subAgentSearchShare",
  "artifactSize",
  "extraSideEffects",
  "destructiveOverwrites",
  "unknownCitationCount",
]);

/**
 * Applies the three metric classes. Zero-classes block on any non-zero value, degrade
 * classes block on any drop and force escalation even inside the noise band, and the
 * improve class only warns once the change leaves the band.
 */
export function judge(caseId, metricName, current, baseline, band) {
  const klass = METRIC_CLASSES[metricName];
  if (klass === "must-be-zero") {
    return current > 0
      ? { caseId, metricName, klass, verdict: "block", detail: `${current} occurrence(s)` }
      : { caseId, metricName, klass, verdict: "pass" };
  }
  if (typeof current !== "number" || typeof baseline !== "number") {
    return { caseId, metricName, klass, verdict: "not-measured" };
  }
  const better = HIGHER_IS_BETTER.has(metricName) ? current >= baseline : current <= baseline;
  if (klass === "must-not-degrade") {
    return better
      ? { caseId, metricName, klass, verdict: "pass" }
      : {
          caseId,
          metricName,
          klass,
          verdict: "block",
          escalate: true,
          detail: `${current} below baseline ${baseline}`,
        };
  }
  if (better) return { caseId, metricName, klass, verdict: "pass" };
  const delta = LOWER_IS_BETTER.has(metricName) ? current - baseline : baseline - current;
  return delta <= band
    ? { caseId, metricName, klass, verdict: "within-noise", detail: `Δ${delta} ≤ band ${band}` }
    : {
        caseId,
        metricName,
        klass,
        verdict: "warn",
        detail: `Δ${delta} > band ${band}; written justification required`,
      };
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** Hash of a fixture directory: every file's relative path and content, sorted. */
export function hashDirectory(directory) {
  const entries = [];
  const walk = (current, prefix) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relative);
      else entries.push(`${relative}:${sha256(readFileSync(full, "utf8"))}`);
    }
  };
  walk(directory, "");
  return sha256(entries.join("\n"));
}

/**
 * Refuses to compare when the baseline no longer describes the same experiment. A stale
 * baseline must be re-measured; reporting its difference as a regression would be wrong.
 */
export function baselineValidity(baseline, current) {
  const reasons = [];
  if (baseline.casesHash !== current.casesHash) reasons.push("case set changed");
  if (baseline.fixturesHash !== current.fixturesHash) reasons.push("fixtures changed");
  const baselineModels = [...(baseline.models ?? [])].sort().join(",");
  const currentModels = [...(current.models ?? [])].sort().join(",");
  if (baselineModels !== currentModels) reasons.push("model set changed");
  return { valid: reasons.length === 0, reasons };
}

/** Ratio gate for the brevity pair: median artefact size with brevity over without. */
export function brevityRatio(brevityCase, controlCase) {
  if (typeof brevityCase !== "number" || typeof controlCase !== "number" || controlCase === 0) {
    return null;
  }
  return brevityCase / controlCase;
}

export function evaluate({ cases, runs, baseline }) {
  const results = [];
  const byCase = new Map();

  for (const testCase of cases.cases) {
    const reports = runs.filter((run) => run.caseId === testCase.id).map((run) => run.report);
    if (reports.length === 0) continue;
    const perRepeat = reports.map((report) => metricsForReport(report, testCase));
    const aggregate = aggregateRepeats(perRepeat);
    byCase.set(testCase.id, aggregate);

    const baselineCase = baseline?.cases?.[testCase.id];
    for (const metricName of Object.keys(METRIC_CLASSES)) {
      const band = noiseBand(baselineCase?.repeats?.[metricName] ?? []);
      results.push(
        judge(
          testCase.id,
          metricName,
          aggregate[metricName],
          baselineCase?.aggregate?.[metricName],
          band,
        ),
      );
    }
  }

  const blocking = results.filter((result) => result.verdict === "block");
  const warnings = results.filter((result) => result.verdict === "warn");
  const escalate = results.filter((result) => result.escalate === true).map((r) => r.caseId);

  return {
    results,
    byCase: Object.fromEntries(byCase),
    verdict: blocking.length > 0 ? "FAIL" : "PASS",
    blocking,
    warnings,
    escalate: [...new Set(escalate)],
  };
}

function formatTable(byCase) {
  const names = Object.keys(METRIC_CLASSES);
  const header = ["case", ...names].join(" | ");
  const rows = Object.entries(byCase).map(([caseId, metrics]) =>
    [caseId, ...names.map((name) => (metrics[name] === null ? "—" : String(metrics[name])))].join(
      " | ",
    ),
  );
  return [header, ...rows].join("\n");
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv) {
  const [casesPath, runsDirectory, baselinePath] = argv;
  if (!casesPath || !runsDirectory) {
    console.error("usage: prompt-eval.mjs <cases.json> <runs-dir> [baseline.json]");
    process.exitCode = 2;
    return;
  }
  const cases = loadJson(resolve(casesPath));
  const runs = readdirSync(resolve(runsDirectory))
    .filter((name) => name.endsWith(".json"))
    .map((name) => loadJson(join(resolve(runsDirectory), name)));

  const baseline = baselinePath ? loadJson(resolve(baselinePath)) : null;
  if (baseline) {
    const validity = baselineValidity(baseline, {
      casesHash: sha256(readFileSync(resolve(casesPath), "utf8")),
      fixturesHash: baseline.fixturesHash,
      models: cases.models,
    });
    if (!validity.valid) {
      console.error(`baseline is stale (${validity.reasons.join("; ")}); re-measure it first`);
      process.exitCode = 3;
      return;
    }
  }

  const report = evaluate({ cases, runs, baseline });
  console.log(formatTable(report.byCase));
  console.log(`\nverdict: ${report.verdict}`);
  for (const entry of report.blocking) {
    console.log(`BLOCK  ${entry.caseId} ${entry.metricName}: ${entry.detail ?? ""}`);
  }
  for (const entry of report.warnings) {
    console.log(`WARN   ${entry.caseId} ${entry.metricName}: ${entry.detail ?? ""}`);
  }
  if (report.escalate.length > 0) {
    console.log(`escalate to full repeats: ${report.escalate.join(", ")}`);
  }
  process.exitCode = report.verdict === "FAIL" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
