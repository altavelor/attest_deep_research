import { MarkdownExtractor } from "@adapters/extractors";
import { IndexResearchTool } from "@adapters/research-tools/index/IndexResearchTool";
import { NoteToolService } from "@adapters/research-tools/note/NoteTools";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { ToolManager } from "@application/tools/ToolManager";
import { NOTE_PERMISSIONS, createNoteTools } from "@adapters/research-tools/note/createNoteTools";
import { ResearchRetriever } from "@application/contracts";
import { MemoryContextFiles } from "../support/noteFakes";

describe("ToolManager", () => {
  it("refuses a tool whose permission is not granted, without invoking the service", async () => {
    const service = {
      definitions: () => [],
      execute: vi.fn(),
    } as unknown as NoteToolService;

    const registry = new ToolManager(createNoteTools(service), new Set([NOTE_PERMISSIONS.read]));

    const result = await registry.execute({
      id: "x",
      name: "create_note",
      arguments: { path: "Private.md" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "tool-unavailable",
        message:
          'Tool "create_note" is not available: it is disabled by the current settings or ' +
          "permissions. Available tools: read_note, search_notes, list_notes.",
        details: { userMessageKey: "chat.toolUnavailable.not-permitted" },
      },
    });
    expect(service.execute).not.toHaveBeenCalled();
  });

  it("hides unpermitted tools from definitions but exposes permitted ones", () => {
    const service = { definitions: () => [], execute: vi.fn() } as unknown as NoteToolService;
    const registry = new ToolManager(createNoteTools(service), new Set([NOTE_PERMISSIONS.read]));

    expect(registry.definitions().map((definition) => definition.function.name)).toEqual([
      "read_note",
      "search_notes",
      "list_notes",
    ]);
    expect(registry.has("read_note")).toBe(true);
    expect(registry.has("create_note")).toBe(false);
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
        code: "tool-unavailable",
        message:
          'Tool "invented_tool" is not available: it is not offered in this run. ' +
          "No tools are available; answer in plain text.",
        retryable: false,
        details: {
          userMessageKey: "chat.toolUnavailable.not-offered",
          params: { tool: "invented_tool" },
        },
      },
    });
  });

  it("delegates a permitted note tool to the service and adapts its payload", async () => {
    const notes = new NoteToolService({
      files: new MemoryContextFiles({ "Notes/One.md": "# One\n\nNote content" }),
      extractors: [new MarkdownExtractor()],
    });
    const registry = new ToolManager(createNoteTools(notes), new Set([NOTE_PERMISSIONS.read]));

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
