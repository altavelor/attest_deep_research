import { MarkdownExtractor } from "../../src/extractors/MarkdownExtractor";
import { NoteToolService } from "../../src/research/NoteTools";
import { ContextFileProvider } from "../../src/research/ContextAssembler";
import { ResearchRetriever } from "../../src/research/types";
import { citation, emptyRetrieval, markdownSource, retrieved } from "../helpers/factories";

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
