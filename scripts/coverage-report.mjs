#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const SCOPES = ["src/core", "src/application", "src/adapters", "src/apps", "src/shared"];

/**
 * Parses an LCOV report into per-file line and branch records. Unknown
 * directives are ignored so a newer reporter cannot break the parse.
 */
export function parseLcov(text) {
  const files = new Map();
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const path = normalizePath(line.slice(3));
      current = files.get(path) ?? { path, lines: new Map(), branches: [] };
      files.set(path, current);
      continue;
    }
    if (!current) continue;
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (line.startsWith("DA:")) {
      const [lineNumber, hits] = line.slice(3).split(",");
      const parsedLine = Number(lineNumber);
      const parsedHits = Number(hits);
      if (!Number.isFinite(parsedLine) || !Number.isFinite(parsedHits)) continue;
      current.lines.set(parsedLine, (current.lines.get(parsedLine) ?? 0) + parsedHits);
      continue;
    }
    if (line.startsWith("BRDA:")) {
      const parts = line.slice(5).split(",");
      const taken = parts[3];
      current.branches.push(taken !== "-" && Number(taken) > 0);
    }
  }
  return [...files.values()];
}

function normalizePath(path) {
  const absolute = resolve(path);
  return relative(process.cwd(), absolute).split("\\").join("/");
}

function percent(covered, total) {
  return total === 0 ? null : (covered / total) * 100;
}

function formatPercent(value) {
  return value === null ? "n/a" : `${value.toFixed(2)}%`;
}

/**
 * Aggregates line and branch totals for every reported scope plus the overall
 * total.
 */
export function summarizeScopes(records) {
  const rows = [];
  for (const scope of ["total", ...SCOPES]) {
    const selected =
      scope === "total" ? records : records.filter((record) => record.path.startsWith(`${scope}/`));
    if (selected.length === 0) continue;
    let lines = 0;
    let coveredLines = 0;
    let branches = 0;
    let coveredBranches = 0;
    for (const record of selected) {
      for (const hits of record.lines.values()) {
        lines += 1;
        if (hits > 0) coveredLines += 1;
      }
      for (const taken of record.branches) {
        branches += 1;
        if (taken) coveredBranches += 1;
      }
    }
    rows.push({
      scope,
      lines,
      coveredLines,
      branches,
      coveredBranches,
      linePercent: percent(coveredLines, lines),
      branchPercent: percent(coveredBranches, branches),
    });
  }
  return rows;
}

const C_QUOTE_ESCAPES = { t: 9, n: 10, r: 13, '"': 34, "\\": 92 };

/**
 * Resolves the post-change path of a `+++` diff header. Git C-quotes paths that
 * contain unusual bytes, so a quoted header is decoded from its octal escapes;
 * `/dev/null`, which marks a deleted file, resolves to null.
 */
export function parseDiffHeaderPath(header) {
  const value = header.replace(/\t.*$/, "").trim();
  if (value === "/dev/null") return null;
  if (!value.startsWith('"')) return value.replace(/^b\//, "");

  const bytes = [];
  const body = value.slice(1, value.endsWith('"') ? -1 : undefined);
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== "\\") {
      bytes.push(...new TextEncoder().encode(body[index]));
      continue;
    }
    const next = body[index + 1];
    const octal = /^[0-7]{3}/.exec(body.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
      continue;
    }
    bytes.push(C_QUOTE_ESCAPES[next] ?? new TextEncoder().encode(next ?? "")[0]);
    index += 1;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/^b\//, "");
}

/**
 * Extracts the lines added by a unified diff, keyed by the file path after the
 * change. Deletions and context lines are ignored.
 */
export function parseAddedLines(diffText) {
  const added = new Map();
  let path = null;
  let lineNumber = 0;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+++ ")) {
      path = parseDiffHeaderPath(line.slice(4));
      continue;
    }
    if (line.startsWith("@@")) {
      const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      lineNumber = match ? Number(match[1]) : 0;
      continue;
    }
    if (!path || lineNumber === 0) continue;
    if (line.startsWith("+")) {
      const set = added.get(path) ?? new Set();
      set.add(lineNumber);
      added.set(path, set);
      lineNumber += 1;
      continue;
    }
    if (line.startsWith("-") || line.startsWith("\\")) continue;
    if (line.startsWith(" ") || line === "") lineNumber += 1;
  }
  return added;
}

/**
 * Intersects the added lines of a diff with the instrumented lines of the LCOV
 * report to produce per-file and overall coverage of the changed code.
 */
export function computePatchCoverage(records, addedLines) {
  const byPath = new Map(records.map((record) => [record.path, record]));
  const files = [];
  let total = 0;
  let covered = 0;
  for (const [path, lines] of [...addedLines].sort(([a], [b]) => a.localeCompare(b))) {
    const record = byPath.get(path);
    if (!record) continue;
    const relevant = [...lines].filter((line) => record.lines.has(line)).sort((a, b) => a - b);
    if (relevant.length === 0) continue;
    const uncovered = relevant.filter((line) => (record.lines.get(line) ?? 0) === 0);
    total += relevant.length;
    covered += relevant.length - uncovered.length;
    files.push({
      path,
      total: relevant.length,
      covered: relevant.length - uncovered.length,
      uncovered,
      percent: percent(relevant.length - uncovered.length, relevant.length),
    });
  }
  return { files, total, covered, percent: percent(covered, total) };
}

/**
 * Collapses a sorted list of line numbers into compact `a-b` ranges so the
 * report stays readable when a whole block is uncovered.
 */
export function formatLineRanges(lines, limit = 10) {
  const ranges = [];
  for (const line of lines) {
    const last = ranges[ranges.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  const rendered = ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`));
  if (rendered.length <= limit) return rendered.join(", ");
  return `${rendered.slice(0, limit).join(", ")}, … (+${rendered.length - limit} more)`;
}

/**
 * Renders the Markdown report: a patch-coverage section for the lines this
 * change adds, followed by the aggregate totals per architectural layer.
 */
export function renderMarkdown({ scopes, patch, baseRef }) {
  const out = ["<!-- ixplorer-coverage-report -->", "## Coverage report", ""];
  if (patch === null) {
    out.push("_No diff base available, reporting totals only._", "");
  } else if (patch.total === 0) {
    out.push(`No instrumented lines under \`src/\` were added against \`${baseRef}\`.`, "");
  } else {
    out.push(
      `### Changed lines (vs \`${baseRef}\`)`,
      "",
      `**${formatPercent(patch.percent)}** of ${patch.total} added instrumented lines are covered (${patch.covered} covered, ${patch.total - patch.covered} uncovered).`,
      "",
      "| File | Added lines | Covered | Uncovered lines |",
      "| ---- | ----------- | ------- | --------------- |",
    );
    for (const file of patch.files) {
      out.push(
        `| \`${file.path}\` | ${file.total} | ${formatPercent(file.percent)} | ${file.uncovered.length === 0 ? "—" : formatLineRanges(file.uncovered)} |`,
      );
    }
    out.push("");
  }
  out.push("### Totals", "", "| Scope | Lines | Branches |", "| ----- | ----- | -------- |");
  for (const row of scopes) {
    out.push(
      `| ${row.scope === "total" ? "total" : `\`${row.scope}\``} | ${formatPercent(row.linePercent)} (${row.coveredLines}/${row.lines}) | ${formatPercent(row.branchPercent)} (${row.coveredBranches}/${row.branches}) |`,
    );
  }
  out.push("", "_Generated from `coverage/lcov.info` by `scripts/coverage-report.mjs`._");
  return out.join("\n");
}

function readDiff(baseRef, headRef) {
  try {
    return execFileSync(
      "git",
      ["diff", "--unified=0", "--no-color", `${baseRef}...${headRef}`, "--", "src"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const args = { lcov: "coverage/lcov.info", base: null, head: "HEAD", out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const [key, inlineValue] = argv[index].split("=");
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined && value !== undefined) index += 1;
    if (key === "--lcov") args.lcov = value;
    else if (key === "--base") args.base = value;
    else if (key === "--head") args.head = value;
    else if (key === "--out") args.out = value;
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  let lcov;
  try {
    lcov = readFileSync(args.lcov, "utf8");
  } catch {
    process.stderr.write(`coverage-report: cannot read ${args.lcov}\n`);
    process.exitCode = 1;
    return;
  }
  const records = parseLcov(lcov);
  const diff = args.base ? readDiff(args.base, args.head) : null;
  const patch = diff === null ? null : computePatchCoverage(records, parseAddedLines(diff));
  const markdown = renderMarkdown({
    scopes: summarizeScopes(records),
    patch,
    baseRef: args.base ?? "",
  });
  if (args.out) appendFileSync(args.out, `${markdown}\n`);
  process.stdout.write(`${markdown}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2));
}
