import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("release workflow", () => {
  it("counts plugin downloads across releases using only main.js", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");

    expect(readme).toContain(
      "https://img.shields.io/github/downloads/altavelor/attest_deep_research/main.js?style=flat-square&displayAssetName=false",
    );
    expect(readme).not.toContain(
      "https://img.shields.io/github/downloads/altavelor/attest_deep_research/total?",
    );
  });

  it("publishes and attests only the supported Obsidian assets", () => {
    const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");

    expect(workflow).toContain("attestations: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("actions/attest-build-provenance@");
    expect(workflow).toContain("dist/main.js");
    expect(workflow).toContain("dist/manifest.json");
    expect(workflow).toContain("dist/styles.css");
    expect(workflow).not.toContain(".zip");
  });
});
