import { MarkdownExtractor } from "../../src/extractors/MarkdownExtractor";
import { NoteToolService } from "../../src/research/NoteTools";
import { ContextFileProvider } from "../../src/research/ContextAssembler";
import { ResearchRetriever } from "../../src/research/types";
import { citation, emptyRetrieval, markdownSource, retrieved } from "../helpers/factories";
import { SkillFileStore, SkillRegistry } from "../../src/skills/SkillRegistry";

class MemoryContextFiles implements ContextFileProvider {
  constructor(private readonly files: Record<string, string>) {}

  async listPaths(): Promise<string[]> {
    return Object.keys(this.files).sort();
  }

  async readFile(path: string): Promise<string> {
    return this.files[path] ?? "";
  }

  async getModifiedTime(): Promise<number> {
    return 0;
  }

  async getSize(path: string): Promise<number> {
    return this.files[path]?.length ?? 0;
  }
}

describe("NoteToolService", () => {
  it("reads a discovered skill in full without normal note truncation", async () => {
    const path = ".ixplorer/skills/large/SKILL.md";
    const content = `---\nname: Large\ndescription: Large skill.\n---\n${"x".repeat(20_000)}`;
    const skillStore: SkillFileStore = {
      exists: async (candidate) =>
        candidate === ".ixplorer/skills" ||
        candidate === ".ixplorer/skills/large" ||
        candidate === path,
      list: async () => ({ files: [], folders: [".ixplorer/skills/large"] }),
      read: async () => content,
      write: async () => undefined,
      mkdir: async () => undefined,
    };
    const registry = new SkillRegistry({ store: skillStore, defaults: [] });
    await registry.refresh();
    const service = new NoteToolService({
      files: new MemoryContextFiles({ [path]: content }),
      extractors: [new MarkdownExtractor()],
      readNoteMaxChars: 100,
      skillRegistry: registry,
    });

    const result = await service.execute({
      id: "call-skill",
      name: "read_note",
      arguments: { path },
    });
    const parsed = JSON.parse(result.result) as {
      content: string;
      truncated: boolean;
      skill: boolean;
    };

    expect(result.ok).toBe(true);
    expect(parsed.content).toBe(content);
    expect(parsed.truncated).toBe(false);
    expect(parsed.skill).toBe(true);
  });

  it("reads notes through the context extractor pipeline with truncation metadata", async () => {
    const service = new NoteToolService({
      files: new MemoryContextFiles({
        "Research/Long.md": `# Long\n\n${"Important context. ".repeat(50)}`,
      }),
      extractors: [new MarkdownExtractor({ maxChunkLength: 200, chunkOverlap: 0 })],
      readNoteMaxChars: 180,
    });

    const result = await service.execute({
      id: "call-1",
      name: "read_note",
      arguments: { path: "Research/Long.md" },
    });
    const parsed = JSON.parse(result.result) as {
      ok: boolean;
      path: string;
      content: string;
      truncated: boolean;
      chunks: unknown[];
    };

    expect(result.ok).toBe(true);
    expect(parsed).toMatchObject({
      ok: true,
      path: "Research/Long.md",
      truncated: true,
    });
    expect(parsed.content.length).toBeLessThanOrEqual(180);
    expect(parsed.chunks.length).toBeGreaterThan(0);
  });

  it("uses retrieval for search and falls back to path matching", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [
          retrieved(
            "chunk-1",
            markdownSource("Research/Match.md"),
            "Semantic result with the answer",
          ),
        ],
        citations: [citation("chunk-1", markdownSource("Research/Match.md"))],
        usedFallback: false,
      }),
      getLanguageInventory: async () => [],
    };
    const service = new NoteToolService({
      files: new MemoryContextFiles({
        "Research/Match.md": "body",
        "Daily.md": "body",
      }),
      extractors: [new MarkdownExtractor()],
      retriever,
    });

    const retrievalResult = await service.execute({
      id: "call-1",
      name: "search_notes",
      arguments: { query: "answer" },
    });
    const retrievalParsed = JSON.parse(retrievalResult.result) as { source: string };

    expect(retrievalParsed.source).toBe("retrieval");

    vi.mocked(retriever.search).mockResolvedValue(emptyRetrieval());
    const fallbackResult = await service.execute({
      id: "call-2",
      name: "search_notes",
      arguments: { query: "daily" },
    });
    const fallbackParsed = JSON.parse(fallbackResult.result) as {
      source: string;
      results: Array<{ path: string }>;
    };

    expect(fallbackParsed.source).toBe("path");
    expect(fallbackParsed.results).toEqual([{ path: "Daily.md", snippet: "Daily.md" }]);
  });

  it("filters internal skill chunks from general note search", async () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({
        chunks: [
          retrieved(
            "skill",
            markdownSource(".ixplorer/skills/rag-debugger/SKILL.md"),
            "Internal instruction",
          ),
          retrieved("note", markdownSource("Notes/Real.md"), "Real note"),
        ],
        citations: [],
        usedFallback: false,
      }),
    };
    const service = new NoteToolService({
      files: new MemoryContextFiles({ "Notes/Real.md": "Real note" }),
      extractors: [new MarkdownExtractor()],
      retriever,
    });

    const result = await service.execute({
      id: "call-search",
      name: "search_notes",
      arguments: { query: "note" },
    });
    const parsed = JSON.parse(result.result) as { results: Array<{ path: string }> };

    expect(parsed.results.map((item) => item.path)).toEqual(["Notes/Real.md"]);
  });

  it("lists supported paths with prefix, query, and limit", async () => {
    const service = new NoteToolService({
      files: new MemoryContextFiles({
        "Projects/A.md": "a",
        "Projects/B.md": "b",
        "Archive/C.md": "c",
      }),
      extractors: [new MarkdownExtractor()],
    });

    const result = await service.execute({
      id: "call-1",
      name: "list_notes",
      arguments: { prefix: "Projects", query: ".md", limit: 1 },
    });
    const parsed = JSON.parse(result.result) as {
      paths: string[];
      totalCount: number;
      hasMore: boolean;
    };

    expect(parsed).toEqual({
      ok: true,
      paths: ["Projects/A.md"],
      count: 1,
      totalCount: 2,
      hasMore: true,
      limit: 1,
    });
  });
});
