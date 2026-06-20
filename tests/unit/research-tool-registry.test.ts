import { MarkdownExtractor } from "../../src/extractors/MarkdownExtractor";
import { ContextFileProvider } from "../../src/research/ContextAssembler";
import { IndexResearchTool } from "../../src/research/tools/IndexResearchTool";
import { NoteToolService } from "../../src/research/tools/NoteTools";
import { ResearchEvidenceRegistry } from "../../src/research/tools/ResearchEvidenceRegistry";
import {
  adaptNoteToolHandlers,
  ResearchToolRegistry,
} from "../../src/research/tools/ResearchToolRegistry";
import { ResearchRetriever } from "../../src/research/types";

class MemoryFiles implements ContextFileProvider {
  async listPaths(): Promise<string[]> {
    return ["Notes/One.md"];
  }
  async readFile(): Promise<string> {
    return "# One\n\nNote content";
  }
}

describe("ResearchToolRegistry", () => {
  it("rejects duplicate names during construction", () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const handler = new IndexResearchTool({
      retriever,
      evidence: new ResearchEvidenceRegistry(),
    });

    expect(() => new ResearchToolRegistry([handler, handler])).toThrow(/Duplicate research tool/);
  });

  it("returns a uniform error for unknown tools", async () => {
    const registry = new ResearchToolRegistry([]);

    await expect(
      registry.execute({ id: "unknown", name: "invented_tool", arguments: {} }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "unknown-tool",
        message: "Unknown or unavailable research tool: invented_tool.",
        retryable: false,
      },
    });
  });

  it("adapts existing note schemas and execution payloads without changing them", async () => {
    const notes = new NoteToolService({
      files: new MemoryFiles(),
      extractors: [new MarkdownExtractor()],
    });
    const registry = new ResearchToolRegistry(
      adaptNoteToolHandlers(notes, {
        noteAccess: true,
        activeFileAccess: false,
        skillAccess: false,
      }),
    );

    expect(registry.definitions().map((definition) => definition.function.name)).toEqual([
      "read_note",
      "search_notes",
      "list_notes",
    ]);
    const execution = await registry.execute({
      id: "read",
      name: "read_note",
      arguments: { path: "Notes/One.md" },
    });
    expect(execution).toMatchObject({
      ok: true,
      value: { ok: true, path: "Notes/One.md", content: expect.stringContaining("Note content") },
    });
  });
});
