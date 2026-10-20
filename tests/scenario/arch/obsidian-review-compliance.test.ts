import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string): string => readFileSync(resolve(path), "utf8");

describe("Obsidian review compliance", () => {
  it("never lowers the minimum Obsidian version below an earlier release", () => {
    const manifest = JSON.parse(read("manifest.json")) as {
      version: string;
      minAppVersion: string;
    };
    const versions = JSON.parse(read("versions.json")) as Record<string, string>;
    const highest = Object.values(versions).sort(compareVersions).at(-1);

    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
    expect(manifest.minAppVersion).toBe(highest);
  });

  it("uses Obsidian APIs for the active language and configuration directory", () => {
    const defaults = read("src/adapters/settings/state/defaults.ts");
    const indexingFactory = read("src/apps/obsidian/composition/indexingFactory.ts");
    const languageProbe = read("src/adapters/obsidian/ObsidianLanguageProbe.ts");

    expect(defaults).not.toContain(".obsidian");
    expect(indexingFactory).toContain("ctx.app.vault.configDir");
    expect(languageProbe).toContain("getLanguage");
    expect(languageProbe).not.toMatch(/globalThis|localStorage/);
  });

  it("does not use regex lookbehind in shipped source", () => {
    const files = [
      "src/adapters/indexing/metadata/LlmDocumentSummarizer.ts",
      "src/adapters/retrieval/RetrievalService.ts",
      "src/core/web/sectionRanking.ts",
    ];

    for (const file of files) {
      expect(read(file), file).not.toMatch(/\(\?<=[^)]/);
    }
  });

  it("avoids APIs newer than the declared minimum Obsidian version", () => {
    const files = [
      "src/adapters/obsidian/ObsidianVaultWriter.ts",
      "src/apps/obsidian/main.ts",
      "src/apps/obsidian/ui/chat/AttestChatView.ts",
      "src/apps/obsidian/ui/chat/research/AnswerNoteWriter.ts",
      "src/apps/obsidian/ui/chat/toolOutputViewer.ts",
    ];
    const unsupportedApi = /\.getFolderByPath\(|\.removeCommand\(|\.revealLeaf\(|\.messageEl\b/;

    for (const file of files) {
      expect(read(file), file).not.toMatch(unsupportedApi);
    }
  });

  it("uses Obsidian CSS helpers and avoids innerHTML assignment in reviewed files", () => {
    const composer = read("src/apps/obsidian/ui/chat/ChatComposer.ts");
    const controller = read("src/apps/obsidian/ui/chat/ChatComposerController.ts");
    const readable = read("src/apps/obsidian/ui/diagnostics/readable.ts");

    expect(composer).not.toMatch(/\.style\.(?:height|setProperty|removeProperty)/);
    expect(controller).not.toMatch(/\.style\.(?:height|setProperty|removeProperty)/);
    expect(readable).not.toMatch(/\.innerHTML\s*=/);
    expect(readable).not.toContain("attachShadow");
    expect(readable).not.toContain('createElement("style")');
    expect(readable).not.toContain("createContextualFragment");
  });
});

/** Orders dotted numeric versions by their numeric parts. */
function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
