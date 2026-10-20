#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_CASES_PER_COMMIT = 15;
const JUSTIFICATION = /^Case growth:/m;

/**
 * Turns per-commit case counts into growth rows and flags each commit that
 * adds more than the allowed number of cases without a "Case growth:" line
 * in its message.
 */
export function growthReport(baseCases, commits, limit = MAX_CASES_PER_COMMIT) {
  let previous = baseCases;
  const rows = commits.map((commit) => {
    const added = commit.cases - previous;
    previous = commit.cases;
    const unjustified = added > limit && !JUSTIFICATION.test(commit.message);
    return {
      sha: commit.sha,
      subject: commit.message.split("\n")[0],
      cases: commit.cases,
      added,
      unjustified,
    };
  });
  return { rows, total: previous - baseCases, failed: rows.some((row) => row.unjustified) };
}

/** Counts the collected Vitest cases of a commit in a temporary worktree that shares this checkout's node_modules. */
function countCases(sha) {
  const dir = mkdtempSync(join(tmpdir(), "attest-cases-"));
  try {
    execFileSync("git", ["worktree", "add", "--detach", "--quiet", dir, sha]);
    symlinkSync(resolve("node_modules"), join(dir, "node_modules"), "dir");
    const listed = execFileSync("npx", ["vitest", "list", "--json"], {
      cwd: dir,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(listed).length;
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", dir]);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Prints case growth per commit between the base ref (default origin/main) and HEAD. */
function main() {
  const base = process.argv[2] ?? "origin/main";
  const mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], { encoding: "utf8" }).trim();
  const shas = execFileSync("git", ["rev-list", "--reverse", `${mergeBase}..HEAD`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  const commits = shas.map((sha) => ({
    sha: sha.slice(0, 7),
    message: execFileSync("git", ["log", "-1", "--format=%B", sha], { encoding: "utf8" }),
    cases: countCases(sha),
  }));
  const report = growthReport(countCases(mergeBase), commits);
  for (const row of report.rows) {
    const flag = row.unjustified ? "  <- needs a 'Case growth:' line" : "";
    process.stdout.write(`${row.sha} ${String(row.added).padStart(5)} ${row.subject}${flag}\n`);
  }
  process.stdout.write(`Cases ${report.total >= 0 ? "+" : ""}${report.total} against ${base}.\n`);
  return report.failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
