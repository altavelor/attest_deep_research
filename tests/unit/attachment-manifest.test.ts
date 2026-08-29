import { MarkdownExtractor, stableId } from "@adapters/extractors";
import { ContextAssembler } from "@application/use-cases/chat";
import {
  buildThinkingResearchMessages,
  buildAttachmentManifestSection,
  buildResearchPrompt,
} from "@core/research";
import { expandAttachedContextPaths } from "@apps/obsidian/ui/chat/context/attachmentPaths";

function createAssembler(files: Record<string, string>): ContextAssembler {
  return new ContextAssembler({
    extractors: [new MarkdownExtractor({ maxChunkLength: 400, chunkOverlap: 80 })],
    generateId: stableId,
    files: {
      listPaths: async () => Object.keys(files),
      readFile: async (path) => files[path] ?? "",
      getModifiedTime: async () => 1,
      getSize: async (path) => files[path]?.length ?? 0,
    },
  });
}

describe("buildAttachmentManifestSection", () => {
  it("lists paths with coverage and adapts guidance to tool availability", () => {
    const entries = [
      { path: "notes/Small.md", coverage: "full" as const },
      { path: "notes/Big.md", coverage: "excerpts" as const },
      { path: "notes/Huge.md", coverage: "reference" as const },
    ];
    const withTools = buildAttachmentManifestSection(entries, { noteToolsAvailable: true });
    expect(withTools).toContain("notes/Small.md — full content included");
    expect(withTools).toContain("notes/Big.md — excerpts only");
    expect(withTools).toContain("notes/Huge.md — content not inlined — read it with read_note");
    expect(withTools).toContain("read_note, update_note");

    const withoutTools = buildAttachmentManifestSection(entries);
    expect(withoutTools).not.toContain("update_note");
    expect(buildAttachmentManifestSection([])).toBe("");
  });
});

describe("ContextAssembler attachments", () => {
  it("reports full coverage for a small attached markdown file", async () => {
    const result = await createAssembler({
      "Project.md": "# Project\n\nShort content.",
    }).assemble({
      question: "q",
      contextMode: "include",
      contextPaths: ["Project.md"],
      evidenceLimit: 4,
    });

    expect(result.attachments).toEqual([{ path: "Project.md", coverage: "full" }]);
  });

  it("reports excerpts when a large file is packed by relevance", async () => {
    const filler = "Filler text. ".repeat(900);
    const result = await createAssembler({
      "Large.md": `# Intro\n\n${filler}\n\n# Target\n\nAnswer here.\n\n# Tail\n\n${filler}`,
    }).assemble({
      question: "answer",
      contextMode: "include",
      contextPaths: ["Large.md"],
      evidenceLimit: 2,
      contextLimitTokens: 2_000,
    });

    expect(result.attachments).toEqual([{ path: "Large.md", coverage: "excerpts" }]);
  });

  it("keeps large files as references in reference mode, small ones inline", async () => {
    const filler = "Filler text. ".repeat(2_000);
    const result = await createAssembler({
      "Huge.md": `# A\n\n${filler}`,
      "Tiny.md": "# Tiny\n\nAll of it.",
    }).assemble({
      question: "q",
      contextMode: "include",
      contextPaths: ["Huge.md", "Tiny.md"],
      evidenceLimit: 4,
      largeAttachmentsAsReferences: true,
    });

    expect(result.attachments).toEqual([
      { path: "Huge.md", coverage: "reference" },
      { path: "Tiny.md", coverage: "full" },
    ]);
    expect(result.explicitEvidence.map((chunk) => chunk.source.id)).toHaveLength(1);
  });

  it("reports omitted for unsupported attachments", async () => {
    const result = await createAssembler({ "image.png": "binary" }).assemble({
      question: "q",
      contextMode: "include",
      contextPaths: ["image.png"],
      evidenceLimit: 4,
    });

    expect(result.attachments).toEqual([{ path: "image.png", coverage: "omitted" }]);
  });
});

describe("prompt rendering", () => {
  it("renders the manifest and annotated explicit section in the instant prompt", () => {
    const prompt = buildResearchPrompt({
      question: "q",
      evidence: [],
      explicitEvidence: [
        {
          id: "chunk-1",
          text: "content",
          score: 1,
          contentHash: "h",
          source: { id: "s", kind: "markdown", path: "notes/A.md", title: "A", headingPath: [] },
        },
      ],
      attachedFiles: [{ path: "notes/A.md", coverage: "full" }],
      noteToolsAvailable: true,
      maxEvidenceItems: 5,
    });

    expect(prompt).toContain("Attached files (vault notes the user attached to this message)");
    expect(prompt).toContain("<attached-files>");
    expect(prompt).toContain("</attached-files>");
    expect(prompt).toContain("- notes/A.md — full content included");
    expect(prompt).toContain("Explicit context (content of the attached files listed above):");
    expect(prompt).toContain("read_note, update_note");
  });

  it("includes the manifest in thinking messages gated on read_note", () => {
    const build = (availableTools: string[]) =>
      buildThinkingResearchMessages({
        question: "q",
        requiredTools: [],
        attachedFiles: [{ path: "notes/Huge.md", coverage: "reference" }],
        toolContext: { coreVariant: "research", availableTools },
      })[0].content;

    const withTools = build(["search_web", "read_note"]);
    expect(withTools).toContain("notes/Huge.md — content not inlined");
    expect(withTools).toContain("read_note, update_note");

    const withoutTools = build(["search_web"]);
    expect(withoutTools).toContain("notes/Huge.md");
    expect(withoutTools).not.toContain("update_note");
  });
});

describe("expandAttachedContextPaths", () => {
  const vault = ["research/a.md", "research/sub/b.md", "research/img.png", "other/c.md"];

  it("expands folder attachments recursively to supported files only", () => {
    expect(expandAttachedContextPaths(["research/"], vault)).toEqual([
      "research/a.md",
      "research/sub/b.md",
    ]);
  });

  it("passes file attachments through and deduplicates", () => {
    expect(expandAttachedContextPaths(["research/", "research/a.md", "other/c.md"], vault)).toEqual(
      ["research/a.md", "research/sub/b.md", "other/c.md"],
    );
  });
});
