import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ReleaseCheckModule {
  checkVersionMetadata(input: {
    manifest: Record<string, unknown>;
    packageJson: Record<string, unknown>;
    versions: Record<string, string>;
  }): string[];
  checkReleaseEntries(entries: string[]): string[];
  findSecrets(text: string): string[];
  parseJsonFile(
    path: string,
    read?: (path: string) => string,
  ): { value?: unknown; problem?: string };
}

const specifier = pathToFileURL(resolve("scripts/release-check.mjs")).href;
const releaseCheck = (await import(/* @vite-ignore */ specifier)) as ReleaseCheckModule;
const { checkVersionMetadata, checkReleaseEntries, findSecrets, parseJsonFile } = releaseCheck;

const validManifest = {
  id: "ixplorer",
  version: "0.1.0",
  minAppVersion: "1.5.0",
};

describe("release check version metadata", () => {
  it("accepts a consistent manifest, package and versions triple", () => {
    const problems = checkVersionMetadata({
      manifest: validManifest,
      packageJson: { version: "0.1.0" },
      versions: { "0.1.0": "1.5.0" },
    });

    expect(problems).toEqual([]);
  });

  it("reports a package version that drifted from the manifest", () => {
    const problems = checkVersionMetadata({
      manifest: validManifest,
      packageJson: { version: "0.2.0" },
      versions: { "0.1.0": "1.5.0" },
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("package.json version 0.2.0");
  });

  it("reports a missing and a mismatched versions.json entry", () => {
    const missing = checkVersionMetadata({
      manifest: validManifest,
      packageJson: { version: "0.1.0" },
      versions: { "0.0.9": "1.5.0" },
    });
    const mismatched = checkVersionMetadata({
      manifest: validManifest,
      packageJson: { version: "0.1.0" },
      versions: { "0.1.0": "1.4.0" },
    });

    expect(missing[0]).toContain("does not contain an entry for 0.1.0");
    expect(mismatched[0]).toContain("maps 0.1.0 to 1.4.0");
  });

  it("rejects an invalid version and a plugin id Obsidian would refuse", () => {
    const badVersion = checkVersionMetadata({
      manifest: { ...validManifest, version: "0.1" },
      packageJson: { version: "0.1" },
      versions: { "0.1": "1.5.0" },
    });
    const badId = checkVersionMetadata({
      manifest: { ...validManifest, id: "obsidian-ixplorer" },
      packageJson: { version: "0.1.0" },
      versions: { "0.1.0": "1.5.0" },
    });

    expect(badVersion[0]).toContain("not a valid semantic version");
    expect(badId).toContain('manifest.json id must not contain "obsidian"');
  });

  it("reports valid JSON values with an invalid metadata shape", () => {
    expect(
      checkVersionMetadata({
        manifest: null as unknown as Record<string, unknown>,
        packageJson: [] as unknown as Record<string, unknown>,
        versions: "0.1.0" as unknown as Record<string, string>,
      }),
    ).toEqual([
      "manifest.json must contain a JSON object",
      "package.json must contain a JSON object",
      "versions.json must contain a JSON object",
    ]);
  });
});

describe("release check release directory entries", () => {
  it("accepts exactly the assets Obsidian loads", () => {
    expect(checkReleaseEntries(["main.js", "manifest.json", "styles.css"])).toEqual([]);
  });

  it("reports missing assets", () => {
    const problems = checkReleaseEntries(["main.js"]);

    expect(problems).toEqual([
      expect.stringContaining("manifest.json is missing"),
      expect.stringContaining("styles.css is missing"),
    ]);
  });

  it("reports entries that must never be published", () => {
    const problems = checkReleaseEntries([
      "main.js",
      "manifest.json",
      "styles.css",
      "node_modules",
      "all.log",
      "main.js.map",
      ".env",
    ]);

    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain("node_modules");
    expect(problems.join("\n")).toContain("all.log");
    expect(problems.join("\n")).toContain("main.js.map");
  });
});

describe("release check secret scan", () => {
  it("detects known provider credential formats", () => {
    expect(findSecrets(`key = "sk-ant-${"a".repeat(24)}"`)).toEqual(["Anthropic API key"]);
    expect(findSecrets(`OPENAI_API_KEY=sk-${"B".repeat(40)}`)).toEqual(["OpenAI API key"]);
    expect(findSecrets(`token: ghp_${"c".repeat(36)}`)).toEqual(["GitHub token"]);
    expect(findSecrets("-----BEGIN RSA PRIVATE KEY-----")).toEqual(["PEM private key"]);
  });

  it("does not flag ordinary built output", () => {
    expect(findSecrets('const apiKey=settings.apiKey??"";export{apiKey};')).toEqual([]);
  });
});

describe("release check JSON parsing", () => {
  it("returns the parsed value for valid JSON", () => {
    expect(parseJsonFile("manifest.json", () => '{"version":"0.1.0"}')).toEqual({
      value: { version: "0.1.0" },
    });
  });

  it("names the file when JSON is malformed", () => {
    const result = parseJsonFile("manifest.json", () => "{oops}");

    expect(result.value).toBeUndefined();
    expect(result.problem).toContain("manifest.json is not valid JSON");
  });
});
