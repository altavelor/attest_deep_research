#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const COST_FIELDS = ["rounds", "searches", "tokens", "activeMs"];
const UNAVAILABLE = "unavailable";

function normalize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function caseEvidence(entry) {
  return [...entry.objectives.flatMap((objective) => objective.evidence), ...entry.contradicting];
}

function evidenceFor(entry, claim) {
  const objective = entry.objectives.find((candidate) => candidate.id === claim.objective);
  return objective ? objective.evidence : caseEvidence(entry);
}

/** True when the cited excerpt comes from the gold note and contains one gold passage verbatim. */
export function citationSupports(citation, evidence) {
  const excerpt = normalize(citation?.excerpt);
  return evidence.some(
    (passage) => citation?.path === passage.path && excerpt.includes(normalize(passage.quote)),
  );
}

function syndicateOf(syndicates, path) {
  return syndicates.findIndex((group) => group.includes(path));
}

function countCopiedSupport(claims, syndicates) {
  return claims.filter((claim) => {
    const groups = (claim.citations ?? [])
      .map((citation) => syndicateOf(syndicates, citation.path))
      .filter((index) => index >= 0);
    const paths = new Set(
      (claim.citations ?? [])
        .filter((citation) => syndicateOf(syndicates, citation.path) >= 0)
        .map((citation) => citation.path),
    );
    return paths.size > new Set(groups).size;
  }).length;
}

function costOf(cost) {
  return Object.fromEntries(
    COST_FIELDS.map((field) => [field, Number.isFinite(cost?.[field]) ? cost[field] : null]),
  );
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validClaims(answer) {
  if (!Array.isArray(answer?.claims)) return null;
  const valid = answer.claims.every(
    (claim) =>
      isObject(claim) &&
      (claim.citations === undefined ||
        (Array.isArray(claim.citations) && claim.citations.every(isObject))),
  );
  return valid ? answer.claims : null;
}

/** Scores one recorded answer against one gold case; a metric that cannot be computed is null. */
export function scoreRun(entry, answer, syndicates = [], cost = undefined) {
  const claims = validClaims(answer);
  const text = typeof answer?.text === "string" ? normalize(answer.text) : null;
  const metrics = { ...costOf(cost) };
  if (claims === null) {
    return {
      objectiveCoverage: null,
      citationSupport: null,
      unreportedConflicts: text === null ? null : unreported(entry, text),
      copiedSourcesAsIndependent: null,
      unsupportedCertainty: null,
      ...metrics,
    };
  }
  const supported = (claim) =>
    (claim.citations ?? []).some((citation) =>
      citationSupports(citation, evidenceFor(entry, claim)),
    );
  const citations = claims.flatMap((claim) =>
    (claim.citations ?? []).map((citation) => ({ claim, citation })),
  );
  const covered = entry.objectives.filter((objective) =>
    claims.some(
      (claim) =>
        claim.objective === objective.id &&
        objective.markers.every((marker) => normalize(claim.text).includes(normalize(marker))) &&
        supported(claim),
    ),
  ).length;
  return {
    objectiveCoverage: covered / entry.objectives.length,
    citationSupport:
      citations.length === 0
        ? null
        : citations.filter(({ claim, citation }) =>
            citationSupports(citation, evidenceFor(entry, claim)),
          ).length / citations.length,
    unreportedConflicts: text === null ? null : unreported(entry, text),
    copiedSourcesAsIndependent: countCopiedSupport(claims, syndicates),
    unsupportedCertainty: claims.filter(
      (claim) => claim.certainty !== "hedged" && !supported(claim),
    ).length,
    ...metrics,
  };
}

function unreported(entry, text) {
  return entry.conflicts.filter(
    (conflict) => !conflict.markers.every((marker) => text.includes(normalize(marker))),
  ).length;
}

/** The gold answer of a case: every objective claimed with its passages and every conflict named. */
export function positiveControl(entry) {
  const claims = entry.objectives.map((objective) => ({
    objective: objective.id,
    text: objective.markers.join(" "),
    certainty: "asserted",
    citations: objective.evidence.map((passage) => ({
      path: passage.path,
      excerpt: passage.quote,
    })),
  }));
  const named = entry.conflicts.flatMap((conflict) => conflict.markers).join(" ");
  return { text: `${claims.map((claim) => claim.text).join(" ")} ${named}`, claims };
}

/** A confident answer that cites the gold notes by their heading only, never by a gold passage. */
export function negativeControl(entry, corpus) {
  const claims = entry.objectives.map((objective) => ({
    objective: objective.id,
    text: objective.markers.join(" "),
    certainty: "asserted",
    citations: objective.evidence.map((passage) => ({
      path: passage.path,
      excerpt: (corpus[passage.path] ?? "").split("\n")[0],
    })),
  }));
  return { text: "", claims };
}

/** Problems that make the scorer itself untrustworthy: missing gold passages or failed controls. */
export function selfCheck(cases, corpus) {
  const problems = [];
  for (const entry of cases.cases) {
    for (const passage of caseEvidence(entry)) {
      if (!normalize(corpus[passage.path]).includes(normalize(passage.quote))) {
        problems.push(`${entry.id}: gold passage not in corpus: ${passage.path}`);
      }
    }
    const positive = scoreRun(entry, positiveControl(entry), cases.syndicates);
    if (
      positive.objectiveCoverage !== 1 ||
      positive.citationSupport !== 1 ||
      positive.unreportedConflicts !== 0 ||
      positive.unsupportedCertainty !== 0
    ) {
      problems.push(`${entry.id}: positive control is not scored as a full answer`);
    }
    const negative = scoreRun(entry, negativeControl(entry, corpus), cases.syndicates);
    if (
      negative.citationSupport !== 0 ||
      negative.objectiveCoverage !== 0 ||
      negative.unsupportedCertainty !== entry.objectives.length ||
      negative.unreportedConflicts !== entry.conflicts.length
    ) {
      problems.push(`${entry.id}: negative control is not scored as an unsupported answer`);
    }
  }
  return problems;
}

function median(values) {
  const present = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  const middle = Math.floor(present.length / 2);
  return present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function listFiles(directory) {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? listFiles(path) : [path];
    });
}

function readCorpus(directory) {
  return Object.fromEntries(
    listFiles(directory).map((path) => [
      relative(directory, path).split("\\").join("/"),
      readFileSync(path, "utf8"),
    ]),
  );
}

function fingerprintOf(runs, field) {
  const values = new Set(runs.map((run) => run[field] ?? UNAVAILABLE));
  if (values.size > 1) throw new Error(`runs disagree on ${field}: ${[...values].join(", ")}`);
  return values.size === 1 ? [...values][0] : UNAVAILABLE;
}

/** Scores every run of one mode and profile and returns the result document with its fingerprints. */
export function buildResult({ cases, casesText, corpus, profile, mode, runs, measuredAt }) {
  const selected = runs.filter((run) => run.mode === mode && run.profile === profile.id);
  const perCase = {};
  const missing = [];
  for (const entry of cases.cases) {
    const own = selected.filter((run) => run.caseId === entry.id);
    if (own.length < entry.repeats) missing.push(`${entry.id} (${own.length}/${entry.repeats})`);
    const scored = own.map((run) => scoreRun(entry, run.answer, cases.syndicates, run.cost));
    const metricNames = Object.keys(scoreRun(entry, null));
    perCase[entry.id] = {
      group: entry.group,
      repeats: scored.length,
      aggregate: Object.fromEntries(
        metricNames.map((name) => [name, median(scored.map((score) => score[name]))]),
      ),
    };
  }
  const corpusText = Object.entries(corpus)
    .map(([path, text]) => `${path}\n${sha256(text)}`)
    .join("\n");
  return {
    mode,
    profile: profile.id,
    model: profile.model,
    measuredAt,
    fingerprints: {
      model: fingerprintOf(selected, "modelVersion"),
      prompt: fingerprintOf(selected, "promptHash"),
      policy: fingerprintOf(selected, "policyHash"),
      corpus: sha256(corpusText),
      cases: sha256(casesText),
    },
    missing,
    perCase,
  };
}

function readRun(path) {
  try {
    const run = JSON.parse(readFileSync(path, "utf8"));
    return isObject(run) ? run : null;
  } catch {
    return null;
  }
}

function main(argv) {
  const options = Object.fromEntries(
    argv.flatMap((value, index) =>
      value.startsWith("--") ? [[value.slice(2), argv[index + 1]]] : [],
    ),
  );
  const configPath = argv[0];
  if (!configPath || !options.mode || !options.profile || !options.runs || !options.out) {
    console.error(
      "usage: deep-research-eval.mjs <runner.config.json> --mode <mode> --profile <id> --runs <dir> --out <result.json>",
    );
    process.exitCode = 2;
    return;
  }
  const configDirectory = dirname(resolve(configPath));
  const config = JSON.parse(readFileSync(resolve(configPath), "utf8"));
  const profile = config.profiles.find((candidate) => candidate.id === options.profile);
  if (!profile || !config.modes.includes(options.mode)) {
    console.error(`unknown profile or mode: ${options.profile} / ${options.mode}`);
    process.exitCode = 2;
    return;
  }
  const casesPath = resolve(configDirectory, config.cases);
  const casesText = readFileSync(casesPath, "utf8");
  const cases = JSON.parse(casesText);
  const corpus = readCorpus(resolve(dirname(casesPath), cases.corpus));
  const problems = selfCheck(cases, corpus);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`SCORER  ${problem}`);
    process.exitCode = 4;
    return;
  }
  const runsDirectory = resolve(options.runs);
  const runs = [];
  for (const name of readdirSync(runsDirectory).filter((file) => file.endsWith(".json"))) {
    const run = readRun(join(runsDirectory, name));
    if (run === null) {
      console.error(`unreadable run file: ${name}`);
      process.exitCode = 5;
      return;
    }
    runs.push(run);
  }
  const result = buildResult({
    cases,
    casesText,
    corpus,
    profile,
    mode: options.mode,
    runs,
    measuredAt: new Date().toISOString(),
  });
  writeFileSync(resolve(options.out), `${JSON.stringify(result, null, 2)}\n`);
  for (const entry of result.missing) console.error(`MISSING ${entry}`);
  console.log(`wrote ${options.out}`);
  process.exitCode = result.missing.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
