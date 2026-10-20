#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAX_CASES_PER_BRANCH = 0.2;

/**
 * Compares the number of test cases with the number of source branches and
 * returns a failure message when the suite is denser than the limit, or null
 * when it fits.
 */
export function densityViolation({ cases, branches, limit = MAX_CASES_PER_BRANCH }) {
  if (!Number.isInteger(cases) || !Number.isInteger(branches) || branches <= 0) {
    return `Cannot measure test density from ${cases} cases and ${branches} branches.`;
  }
  const density = cases / branches;
  if (density <= limit) return null;
  return `Test density ${density.toFixed(3)} cases per branch exceeds ${limit} (${cases} cases, ${branches} branches).`;
}

/** Reads the Vitest JSON report and the coverage summary and prints the density verdict. */
function main() {
  const results = JSON.parse(readFileSync("coverage/test-results.json", "utf8"));
  const summary = JSON.parse(readFileSync("coverage/coverage-summary.json", "utf8"));
  const cases = results.numTotalTests;
  const branches = summary.total.branches.total;
  const violation = densityViolation({ cases, branches });
  if (violation) {
    process.stderr.write(`${violation}\n`);
    return 1;
  }
  process.stdout.write(
    `Test density ${(cases / branches).toFixed(3)} cases per branch (limit ${MAX_CASES_PER_BRANCH}).\n`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
