import { MarkdownExtractor } from "@adapters/extractors";
import { ContextFileProvider } from "@application/ports";
import { NoteToolService } from "@adapters/research-tools";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { createNoteTools, NOTE_PERMISSIONS } from "@adapters/research-tools/note/createNoteTools";
import { NOTE_TOOL_DEFINITIONS } from "@adapters/research-tools/note/noteToolDefinitions";
import { ToolManager } from "@application/tools/ToolManager";
import {
  GET_ACTIVE_NOTE_TOOL,
  LIST_NOTES_TOOL,
  READ_NOTE_TOOL,
  SEARCH_NOTES_TOOL,
} from "@core/agent";

class MemoryFiles implements ContextFileProvider {
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

const FILES = {
  "Research/Caffeine.md":
    "# Caffeine\n\nThe caffeine half-life in healthy adults is about five hours on average.",
};

function harness(activePath?: string) {
  const evidence = new ResearchEvidenceRegistry();
  const service = new NoteToolService({
    files: new MemoryFiles(FILES),
    extractors: [new MarkdownExtractor({ maxChunkLength: 400, chunkOverlap: 0 })],
    ...(activePath ? { getActiveFilePath: () => activePath } : {}),
  });
  const tools = new ToolManager(
    createNoteTools(service, evidence),
    new Set([NOTE_PERMISSIONS.read, NOTE_PERMISSIONS.active]),
  );
  return { evidence, tools };
}

async function call(
  tools: ToolManager,
  name: string,
  args: Record<string, unknown>,
  callId = "call-1",
) {
  return tools.execute({ id: callId, name, arguments: args });
}

describe("note reads register citable evidence", () => {
  it("registers every chunk read_note returned, keyed by its evidenceId", async () => {
    const { evidence, tools } = harness();
    const execution = await call(tools, READ_NOTE_TOOL, { path: "Research/Caffeine.md" });
    expect(execution.ok).toBe(true);

    const value = execution.ok ? (execution.value as { chunks: Array<{ id: string }> }) : null;
    const snapshot = evidence.snapshot();
    const registeredIds = snapshot.evidence.map((chunk) => chunk.id);

    expect(value?.chunks.length).toBeGreaterThan(0);
    for (const chunk of value?.chunks ?? []) {
      expect(registeredIds).toContain(chunk.id);
    }
    expect(snapshot.provenance[0]?.calls[0]).toMatchObject({
      callId: "call-1",
      tool: READ_NOTE_TOOL,
    });
  });

  it("makes the registered chunk citable with its real text", async () => {
    const { evidence, tools } = harness();
    await call(tools, READ_NOTE_TOOL, { path: "Research/Caffeine.md" });

    const registered = evidence.snapshot().evidence[0];
    expect(registered.text).toContain("caffeine half-life");
    expect(evidence.snapshot().citations.map((citation) => citation.id)).toContain(registered.id);
  });

  it("registers the active note read under its own provenance tool", async () => {
    const { evidence, tools } = harness("Research/Caffeine.md");
    await call(tools, GET_ACTIVE_NOTE_TOOL, {}, "call-2");

    expect(evidence.snapshot().evidence.length).toBeGreaterThan(0);
    expect(evidence.snapshot().provenance[0]?.calls[0]).toMatchObject({
      callId: "call-2",
      tool: GET_ACTIVE_NOTE_TOOL,
    });
  });

  it("registers nothing for navigation results", async () => {
    const { evidence, tools } = harness();
    await call(tools, SEARCH_NOTES_TOOL, { query: "Caffeine" });
    await call(tools, LIST_NOTES_TOOL, { prefix: "Research" }, "call-3");

    expect(evidence.snapshot().evidence).toEqual([]);
  });

  it("registers nothing when the read failed", async () => {
    const { evidence, tools } = harness();
    const execution = await call(tools, READ_NOTE_TOOL, { path: "Missing.md" });

    expect(execution.ok).toBe(false);
    expect(evidence.snapshot().evidence).toEqual([]);
  });

  it("registers nothing when no active note is open", async () => {
    const { evidence, tools } = harness();
    await call(tools, GET_ACTIVE_NOTE_TOOL, {});

    expect(evidence.snapshot().evidence).toEqual([]);
  });

  it("survives a malformed chunk payload without failing the call", async () => {
    const evidence = new ResearchEvidenceRegistry();
    const service = {
      execute: async () =>
        ({
          ok: true,
          result: JSON.stringify({
            ok: true,
            chunks: [
              null,
              {},
              { id: 1 },
              { id: "a", text: 1 },
              { id: "b", text: "t" },
              { id: "c", text: "t", evidenceSource: {} },
              { id: "d", text: "t", evidenceSource: { kind: 7 } },
              { id: "e", text: "t", evidenceSource: [] },
            ],
          }),
        }) as never,
    } as unknown as NoteToolService;
    const tools = new ToolManager(
      createNoteTools(service, evidence),
      new Set([NOTE_PERMISSIONS.read]),
    );

    const execution = await call(tools, READ_NOTE_TOOL, { path: "A.md" });
    expect(execution.ok).toBe(true);
    expect(evidence.snapshot().evidence).toEqual([]);
  });

  it("does not let a later read overwrite an already registered chunk", async () => {
    const { evidence, tools } = harness();
    await call(tools, READ_NOTE_TOOL, { path: "Research/Caffeine.md" }, "call-1");
    const first = evidence.snapshot().evidence[0];
    await call(tools, READ_NOTE_TOOL, { path: "Research/Caffeine.md" }, "call-9");

    const after = evidence.snapshot().evidence.filter((chunk) => chunk.id === first.id);
    expect(after).toHaveLength(1);
    expect(after[0].text).toBe(first.text);
  });

  it("never advertises an id it could not register once the budget is spent", async () => {
    const evidence = new ResearchEvidenceRegistry();
    let round = 0;
    const service = {
      execute: async () => {
        round += 1;
        return {
          ok: true,
          result: JSON.stringify({
            ok: true,
            path: "A.md",
            evidenceId: `c-${round}-0`,
            chunks: Array.from({ length: 20 }, (_, index) => ({
              id: `c-${round}-${index}`,
              text: "x".repeat(4_000),
              evidenceSource: {
                id: "s",
                kind: "markdown",
                title: "A",
                path: "A.md",
                headingPath: [],
              },
            })),
          }),
        } as never;
      },
    } as unknown as NoteToolService;
    const tools = new ToolManager(
      createNoteTools(service, evidence),
      new Set([NOTE_PERMISSIONS.read]),
    );

    const advertised: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const execution = await tools.execute({
        id,
        name: READ_NOTE_TOOL,
        arguments: { path: "A.md" },
      });
      expect(execution.ok).toBe(true);
      const value = execution.ok
        ? (execution.value as { evidenceId?: string; chunks: Array<{ id?: string }> })
        : null;
      for (const chunk of value?.chunks ?? []) {
        if (chunk.id !== undefined) advertised.push(chunk.id);
      }
      if (value?.evidenceId !== undefined) advertised.push(value.evidenceId);
    }

    const registered = new Set(evidence.snapshot().evidence.map((chunk) => chunk.id));
    expect(registered.size).toBeGreaterThan(0);
    expect(advertised.length).toBeGreaterThan(0);
    expect(advertised.filter((id) => !registered.has(id))).toEqual([]);
  });

  it("stops registering once the run's evidence budget is spent", async () => {
    const evidence = new ResearchEvidenceRegistry();
    let round = 0;
    const service = {
      execute: async () => {
        round += 1;
        return {
          ok: true,
          result: JSON.stringify({
            ok: true,
            chunks: Array.from({ length: 20 }, (_, index) => ({
              id: `c-${round}-${index}`,
              text: "x".repeat(4_000),
              evidenceSource: {
                id: "s",
                kind: "markdown",
                title: "A",
                path: "A.md",
                headingPath: [],
              },
            })),
          }),
        } as never;
      },
    } as unknown as NoteToolService;
    const tools = new ToolManager(
      createNoteTools(service, evidence),
      new Set([NOTE_PERMISSIONS.read]),
    );

    for (const id of ["a", "b", "c"]) {
      await tools.execute({ id, name: READ_NOTE_TOOL, arguments: { path: "A.md" } });
    }
    const registeredChars = evidence
      .snapshot()
      .evidence.reduce((total, chunk) => total + chunk.text.length, 0);
    expect(registeredChars).toBeLessThanOrEqual(96_000);
    expect(evidence.snapshot().evidence.length).toBe(24);
  });

  it("works without a registry, leaving the tool result unchanged", async () => {
    const service = new NoteToolService({
      files: new MemoryFiles(FILES),
      extractors: [new MarkdownExtractor({ maxChunkLength: 400, chunkOverlap: 0 })],
    });
    const tools = new ToolManager(createNoteTools(service), new Set([NOTE_PERMISSIONS.read]));
    const execution = await call(tools, READ_NOTE_TOOL, { path: "Research/Caffeine.md" });

    expect(execution.ok).toBe(true);
  });
});

describe("note tool descriptions agree with the evidence policy", () => {
  const readNote = NOTE_TOOL_DEFINITIONS.find(
    (definition) => definition.function.name === READ_NOTE_TOOL,
  );
  const activeNote = NOTE_TOOL_DEFINITIONS.find(
    (definition) => definition.function.name === GET_ACTIVE_NOTE_TOOL,
  );
  const searchNotes = NOTE_TOOL_DEFINITIONS.find(
    (definition) => definition.function.name === SEARCH_NOTES_TOOL,
  );

  it("no longer tells the model that read content is not citable", () => {
    expect(readNote?.function.description).not.toContain("NOT citable evidence");
    expect(readNote?.function.description).toContain("registered evidence");
    expect(activeNote?.function.description).not.toContain("not citable evidence");
    expect(activeNote?.function.description).toContain("registered evidence");
  });

  it("keeps navigation results outside the evidence model", () => {
    expect(searchNotes?.function.description).toContain("NOT evidence");
  });
});
