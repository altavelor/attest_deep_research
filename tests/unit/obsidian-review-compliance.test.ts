import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string): string => readFileSync(resolve(path), "utf8");

describe("Obsidian review compliance", () => {
  it("declares the minimum version required by the reviewed Obsidian APIs", () => {
    const manifest = JSON.parse(read("manifest.json")) as { minAppVersion: string };
    const versions = JSON.parse(read("versions.json")) as Record<string, string>;

    expect(manifest.minAppVersion).toBe("1.6.6");
    expect(versions["0.4.4"]).toBe("1.6.6");
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
