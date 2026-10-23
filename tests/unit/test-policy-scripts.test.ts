import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface GrowthCommit {
  sha: string;
  message: string;
  cases: number;
}

interface DensityModule {
  densityViolation(input: { cases: number; branches: number; limit?: number }): string | null;
}

interface GrowthModule {
  growthReport(
    baseCases: number,
    commits: GrowthCommit[],
  ): {
    rows: { sha: string; added: number; unjustified: boolean }[];
    total: number;
    failed: boolean;
  };
}

const load = async <T>(path: string): Promise<T> =>
  (await import(/* @vite-ignore */ pathToFileURL(resolve(path)).href)) as T;

const { densityViolation } = await load<DensityModule>("scripts/test-density.mjs");
const { growthReport } = await load<GrowthModule>("scripts/test-growth.mjs");

describe("test density check", () => {
  it("accepts a suite at the case-per-branch limit", () => {
    expect(densityViolation({ cases: 20, branches: 100 })).toBeNull();
  });

  it("rejects a suite above the limit and names its counts", () => {
    expect(densityViolation({ cases: 21, branches: 100 })).toBe(
      "Test density 0.210 cases per branch exceeds 0.2 (21 cases, 100 branches).",
    );
  });

  it("refuses to measure a report without branches", () => {
    expect(densityViolation({ cases: 3, branches: 0 })).toBe(
      "Cannot measure test density from 3 cases and 0 branches.",
    );
  });
});

describe("test growth report", () => {
  it("flags only an unjustified commit that adds more than fifteen cases", () => {
    const report = growthReport(100, [
      { sha: "a", message: "test: add rule", cases: 115 },
      { sha: "b", message: "test: add more", cases: 131 },
      { sha: "c", message: "feat: big\n\nCase growth: one case per provider", cases: 147 },
      { sha: "d", message: "test: reduce", cases: 90 },
    ]);

    expect(report.rows.map((row) => [row.sha, row.added, row.unjustified])).toEqual([
      ["a", 15, false],
      ["b", 16, true],
      ["c", 16, false],
      ["d", -57, false],
    ]);
    expect(report).toMatchObject({ total: -10, failed: true });
  });
});
