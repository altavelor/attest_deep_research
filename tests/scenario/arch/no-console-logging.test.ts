import { readdirSync, readFileSync } from "fs";
import { join } from "path";

describe("privacy boundaries in production source", () => {
  it("does not log source content or generated answers from production code by default", () => {
    const allowedLogger = join(process.cwd(), "src/adapters/settings/debugLogger.ts");
    const files = sourceFiles(join(process.cwd(), "src")).filter((file) => file !== allowedLogger);
    const consoleCallPattern = /\bconsole\.(?:debug|info|log|warn|error)\s*\(/;
    const offenders = files.filter((file) => consoleCallPattern.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}
