import { readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("source comment policy", () => {
  it("does not contain inline line comments", () => {
    const violations = sourceFiles(resolve("src")).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /^[\t ]+\/\//.test(line) || /\S[\t ]+\/\/[^/]/.test(line) ? [`${path}:${index + 1}`] : [],
        ),
    );

    expect(violations).toEqual([]);
  });
});
