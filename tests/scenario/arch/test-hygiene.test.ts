import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

const ROOT = process.cwd();
const TESTS = join(ROOT, "tests");

/** Lists the files under a directory, recursively, as repository-relative POSIX paths. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)).split(sep).join("/"));
}

const testSources = listFiles(TESTS).filter((path) => path.endsWith(".ts"));
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const testText = new Map(testSources.map((path) => [path, read(path)]));

/** Returns the test sources other than the given one that mention a word. */
function mentionsOutside(word: string, ownPath: string): string[] {
  const pattern = new RegExp(`\\b${word}\\b`);
  return [...testText]
    .filter(([path, text]) => path !== ownPath && pattern.test(text))
    .map(([path]) => path);
}

describe("test suite hygiene", () => {
  it("keeps test files only in tests/unit and tests/scenario", () => {
    const misplaced = testSources.filter(
      (path) =>
        path.endsWith(".test.ts") &&
        !path.startsWith("tests/unit/") &&
        !path.startsWith("tests/scenario/"),
    );
    expect(misplaced).toEqual([]);
  });

  it("keeps unit tests free of file system, network, subprocesses and the clock", () => {
    const forbidden =
      /(?:from\s+|import\(\s*|require\(\s*)["'](?:node:)?(?:fs|fs\/promises|os|child_process|net|http|https|dns|tls|dgram|readline|worker_threads)["']|set(?:Timeout|Interval)\([^,]+,\s*[1-9]|vi\.waitFor\(/;
    const offenders = testSources.filter(
      (path) => path.startsWith("tests/unit/") && forbidden.test(testText.get(path) ?? ""),
    );
    expect(offenders).toEqual([]);
  });

  it("mentions every failure code the source raises in at least one test", () => {
    const declaredButNeverRaised = [
      "INVALID_SKILL_SELECTION",
      "SKILL_TOO_LARGE",
      "WEB_SEARCH_DISABLED",
    ];
    const declared = read("src/core/errors.ts").match(/^ {2}\| "([A-Z_]+)"/gm) ?? [];
    const codes = declared.map((line) => line.replace(/^ {2}\| "|"$/g, ""));
    const sources = listFiles(join(ROOT, "src")).filter(
      (path) => path.endsWith(".ts") && path !== "src/core/errors.ts",
    );
    const sourceText = sources.map(read).join("\n");
    const raised = codes.filter((code) => sourceText.includes(`"${code}"`));
    const untested = raised.filter((code) => mentionsOutside(code, "").length === 0);

    expect(codes.filter((code) => !raised.includes(code))).toEqual(declaredButNeverRaised);
    expect(untested).toEqual([]);
  });

  it("reads every fixture file from some test", () => {
    const unread = listFiles(join(TESTS, "fixtures")).filter(
      (path) => mentionsOutside(basename(path).replace(/[.]/g, "\\."), "").length === 0,
    );
    expect(unread).toEqual([]);
  });

  it("calls every helper exported from tests/support", () => {
    const helpers = testSources.filter(
      (path) => path.startsWith("tests/support/") && !path.startsWith("tests/support/obsidian/"),
    );
    const uncalled = helpers.flatMap((path) =>
      [
        ...(testText.get(path) ?? "").matchAll(
          /^export (?:async )?(?:function|class|const|let) (\w+)/gm,
        ),
      ]
        .map((match) => match[1])
        .filter((name) => mentionsOutside(name, path).length === 0)
        .map((name) => `${path}: ${name}`),
    );
    expect(uncalled).toEqual([]);
  });
});
