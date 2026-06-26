import { MarkdownExtractor } from "../../src/adapters/extractors/MarkdownExtractor";
import { ContextFileProvider } from "../../src/application/ports/vault";
import { IndexResearchTool } from "../../src/application/sources/tools/IndexResearchTool";
import { NoteToolService } from "../../src/adapters/research-tools/NoteTools";
import { ResearchEvidenceRegistry } from "../../src/adapters/research-tools/ResearchEvidenceRegistry";
import { ToolManager } from "../../src/core/agent/tool";
import { adaptNoteToolHandlers } from "../../src/application/sources/tools/noteToolHandlers";
import { ResearchRetriever } from "../../src/application/contracts/research";

class MemoryFiles implements ContextFileProvider {
  async listPaths(): Promise<string[]> {
    return ["Notes/One.md"];
  }
  async readFile(): Promise<string> {
    return "# One\n\nNote content";
  }
}

describe("ToolManager", () => {
  it("returns unknown-tool when note access is disabled", async () => {
    const service = {
      definitions: () => [],
      execute: vi.fn(),
    } as unknown as import("../../src/adapters/research-tools/NoteTools").NoteToolService;
    const handlers = adaptNoteToolHandlers(service, {
      noteAccess: false,
      activeFileAccess: false,
      noteMutationAccess: false,
    });
    const registry = new ToolManager(handlers);
    const result = await registry.execute({ id: "x", name: "read_note", arguments: { path: "Private.md" } });
    expect(result).toMatchObject({ ok: false, error: { code: "unknown-tool" } });
    expect(service.execute).not.toHaveBeenCalled();
  });

  it("rejects duplicate names during construction", () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const handler = new IndexResearchTool({
      retriever,
      evidence: new ResearchEvidenceRegistry(),
    });

    expect(() => new ToolManager([handler, handler])).toThrow(/Duplicate tool/);
  });

  it("returns a uniform error for unknown tools", async () => {
    const registry = new ToolManager([]);

    await expect(
      registry.execute({ id: "unknown", name: "invented_tool", arguments: {} }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "unknown-tool",
        message: "Unknown or unavailable tool: invented_tool.",
        retryable: false,
      },
    });
  });

  it("adapts existing note schemas and execution payloads without changing them", async () => {
    const notes = new NoteToolService({
      files: new MemoryFiles(),
      extractors: [new MarkdownExtractor()],
    });
    const registry = new ToolManager(
      adaptNoteToolHandlers(notes, {
        noteAccess: true,
        activeFileAccess: false,
        noteMutationAccess: false,
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
