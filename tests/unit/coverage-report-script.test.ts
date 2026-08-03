import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface LcovRecord {
  path: string;
  lines: Map<number, number>;
  branches: boolean[];
}

interface PatchFile {
  path: string;
  total: number;
  covered: number;
  uncovered: number[];
  percent: number | null;
}

interface CoverageReportModule {
  parseLcov(text: string): LcovRecord[];
  summarizeScopes(records: LcovRecord[]): {
    scope: string;
    coveredLines: number;
    lines: number;
    linePercent: number | null;
    branchPercent: number | null;
  }[];
  parseAddedLines(diff: string): Map<string, Set<number>>;
  parseDiffHeaderPath(header: string): string | null;
  computePatchCoverage(
    records: LcovRecord[],
    added: Map<string, Set<number>>,
  ): { files: PatchFile[]; total: number; covered: number; percent: number | null };
  formatLineRanges(lines: number[], limit?: number): string;
  renderMarkdown(input: {
    scopes: ReturnType<CoverageReportModule["summarizeScopes"]>;
    patch: ReturnType<CoverageReportModule["computePatchCoverage"]> | null;
    baseRef: string;
  }): string;
}

const specifier = pathToFileURL(resolve("scripts/coverage-report.mjs")).href;
const reportModule = (await import(/* @vite-ignore */ specifier)) as CoverageReportModule;
const {
  parseLcov,
  summarizeScopes,
  parseAddedLines,
  parseDiffHeaderPath,
  computePatchCoverage,
  formatLineRanges,
  renderMarkdown,
} = reportModule;

const lcov = [
  "SF:src/core/example.ts",
  "DA:1,1",
  "DA:2,0",
  "DA:3,4",
  "BRDA:2,0,0,1",
  "BRDA:2,0,1,-",
  "end_of_record",
  "SF:src/apps/view.ts",
  "DA:10,0",
  "DA:11,0",
  "end_of_record",
  "",
].join("\n");

const diff = [
  "diff --git a/src/core/example.ts b/src/core/example.ts",
  "--- a/src/core/example.ts",
  "+++ b/src/core/example.ts",
  "@@ -1,0 +2,2 @@",
  "+const uncovered = 1;",
  "+const covered = 2;",
  "@@ -8,2 +10,1 @@",
  "-const first = 1;",
  "-const second = 2;",
  "+const replacement = 3;",
  "",
].join("\n");

describe("coverage report script", () => {
  it("parses lcov line hits and branch outcomes", () => {
    const records = parseLcov(lcov);

    expect(records.map((record) => record.path)).toEqual([
      "src/core/example.ts",
      "src/apps/view.ts",
    ]);
    expect(records[0].lines.get(2)).toBe(0);
    expect(records[0].lines.get(3)).toBe(4);
    expect(records[0].branches).toEqual([true, false]);
  });

  it("summarizes each layer separately from the total", () => {
    const rows = summarizeScopes(parseLcov(lcov));
    const byScope = new Map(rows.map((row) => [row.scope, row]));

    expect(byScope.get("total")?.coveredLines).toBe(2);
    expect(byScope.get("total")?.lines).toBe(5);
    expect(byScope.get("src/core")?.linePercent).toBeCloseTo((2 / 3) * 100);
    expect(byScope.get("src/apps")?.linePercent).toBe(0);
    expect(byScope.get("src/core")?.branchPercent).toBe(50);
    expect(byScope.has("src/adapters")).toBe(false);
  });

  it("maps added diff lines to their post-change line numbers and skips deletions", () => {
    const added = parseAddedLines(diff);

    expect([...(added.get("src/core/example.ts") ?? [])]).toEqual([2, 3, 10]);
    expect(added.size).toBe(1);
  });

  it("resolves quoted, prefixed and deleted-file diff header paths", () => {
    expect(parseDiffHeaderPath("b/src/core/example.ts")).toBe("src/core/example.ts");
    expect(parseDiffHeaderPath("/dev/null")).toBeNull();
    expect(parseDiffHeaderPath('"b/src/core/wei\\303\\237.ts"')).toBe("src/core/weiß.ts");
    expect(parseDiffHeaderPath('"b/src/core/a\\tb.ts"')).toBe("src/core/a\tb.ts");
    expect(parseDiffHeaderPath("b/src/core/example.ts\t2026-08-03 12:00:00")).toBe(
      "src/core/example.ts",
    );
  });

  it("attributes no added lines to a deleted file", () => {
    const deletion = [
      "diff --git a/src/core/gone.ts b/src/core/gone.ts",
      "--- a/src/core/gone.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-const gone = 1;",
      "-export default gone;",
    ].join("\n");

    expect(parseAddedLines(deletion).size).toBe(0);
  });

  it("reports coverage of the changed lines only", () => {
    const patch = computePatchCoverage(parseLcov(lcov), parseAddedLines(diff));

    expect(patch.total).toBe(2);
    expect(patch.covered).toBe(1);
    expect(patch.percent).toBe(50);
    expect(patch.files).toEqual([
      {
        path: "src/core/example.ts",
        total: 2,
        covered: 1,
        uncovered: [2],
        percent: 50,
      },
    ]);
  });

  it("ignores added lines the coverage report does not instrument", () => {
    const added = new Map([["src/core/example.ts", new Set([2, 99])]]);

    const patch = computePatchCoverage(parseLcov(lcov), added);

    expect(patch.total).toBe(1);
    expect(patch.files[0].uncovered).toEqual([2]);
  });

  it("collapses uncovered line numbers into ranges", () => {
    expect(formatLineRanges([1, 2, 3, 7, 9, 10])).toBe("1-3, 7, 9-10");
    expect(formatLineRanges([1, 3, 5], 2)).toBe("1, 3, … (+1 more)");
  });

  it("renders changed-line coverage above the totals", () => {
    const records = parseLcov(lcov);
    const markdown = renderMarkdown({
      scopes: summarizeScopes(records),
      patch: computePatchCoverage(records, parseAddedLines(diff)),
      baseRef: "origin/main",
    });

    expect(markdown).toContain("<!-- ixplorer-coverage-report -->");
    expect(markdown).toContain("### Changed lines (vs `origin/main`)");
    expect(markdown).toContain("**50.00%** of 2 added instrumented lines are covered");
    expect(markdown).toContain("| `src/core/example.ts` | 2 | 50.00% | 2 |");
    expect(markdown.indexOf("### Changed lines")).toBeLessThan(markdown.indexOf("### Totals"));
  });

  it("states when no diff base is available instead of pretending the patch is covered", () => {
    const markdown = renderMarkdown({
      scopes: summarizeScopes(parseLcov(lcov)),
      patch: null,
      baseRef: "",
    });

    expect(markdown).toContain("No diff base available");
    expect(markdown).not.toContain("### Changed lines");
  });
});
