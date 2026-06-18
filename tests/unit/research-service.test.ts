import { ResearchService } from "../../src/research/ResearchService";
import { MarkdownExtractor } from "../../src/extractors/MarkdownExtractor";
import { NoteToolService } from "../../src/research/NoteTools";
import { ContextFileProvider } from "../../src/research/ContextAssembler";
import { QueryExpansionService } from "../../src/retrieval/QueryExpansionService";
import {
  buildResearchPrompt,
  buildResearchSystemPrompt,
  extractFollowUpQuestions,
} from "../../src/research/prompts";
import {
  citation,
  emptyRetrieval,
  fixedNow,
  markdownSource,
  pdfSource,
  retrieved,
  webSource,
} from "../helpers/factories";
import { collectAsync } from "../helpers/async";
import { FakeChatModel, FakeRetriever, FakeSearchProvider } from "../helpers/researchFakes";
import { SkillFileStore, SkillRegistry } from "../../src/skills/SkillRegistry";

class MemoryContextFiles implements ContextFileProvider {
  constructor(private readonly files: Record<string, string>) {}

  async listPaths(): Promise<string[]> {
    return Object.keys(this.files).sort();
  }

  async readFile(path: string): Promise<string> {
    return this.files[path] ?? "";
  }
}

async function createSkillRegistry(): Promise<SkillRegistry> {
  const path = ".ixplorer/skills/note-synthesis/SKILL.md";
  const content = [
    "---",
    "name: Note Synthesis",
    "description: Synthesize notes.",
    "---",
    "",
    "# Note Synthesis",
    "SKILL BODY: group findings by theme.",
  ].join("\n");
  const store: SkillFileStore = {
    exists: async (candidate) =>
      candidate === ".ixplorer/skills" ||
      candidate === ".ixplorer/skills/note-synthesis" ||
      candidate === path,
    list: async () => ({ files: [], folders: [".ixplorer/skills/note-synthesis"] }),
    read: async () => content,
    write: async () => undefined,
    mkdir: async () => undefined,
  };
  const registry = new SkillRegistry({ store, defaults: [] });
  await registry.refresh();
  return registry;
}

function registrySnapshotCalls(snapshot: Awaited<ReturnType<SkillRegistry["getSnapshot"]>>) {
  return snapshot.skills.map((skill, index) => ({
    id: `call-skill-${index}`,
    name: "read_note",
    arguments: { path: skill.path },
  }));
}

describe("buildResearchPrompt", () => {
  it("includes only the compact skill catalog until a skill is selected", () => {
    const system = buildResearchSystemPrompt({
      skillCatalog:
        "Available skills:\n- Note Synthesis: Synthesize notes.\n  Path: .ixplorer/skills/note-synthesis/SKILL.md",
    });

    expect(system).toContain("Note Synthesis");
    expect(system).toContain(".ixplorer/skills/note-synthesis/SKILL.md");
    expect(system).not.toContain("SECRET SKILL BODY");
  });

  it("adds the complete inline skill as trusted instructions", () => {
    const system = buildResearchSystemPrompt({
      skillCatalog: "Available skills: one",
      inlineSkill: {
        name: "Note Synthesis",
        path: ".ixplorer/skills/note-synthesis/SKILL.md",
        content: "---\nname: Note Synthesis\n---\nSECRET SKILL BODY",
      },
    });

    expect(system).toContain("Selected skill: Note Synthesis");
    expect(system).toContain("SECRET SKILL BODY");
    expect(system).toContain("trusted skill instructions");
  });

  it("includes retrieved evidence and citation ids within the evidence limit", () => {
    const prompt = buildResearchPrompt({
      question: "How should I use local models?",
      evidence: [
        retrieved("local-1", markdownSource("Research/local.md"), "Local evidence"),
        retrieved("pdf-1", pdfSource("Papers/model.pdf", 3), "PDF evidence"),
        retrieved("extra", markdownSource("Research/extra.md"), "Extra evidence"),
      ],
      maxEvidenceItems: 2,
    });

    expect(prompt).toContain("Question: How should I use local models?");
    expect(prompt).toContain("[local-1] Research/local.md");
    expect(prompt).toContain("Local evidence");
    expect(prompt).toContain("[pdf-1] Papers/model.pdf p. 3");
    expect(prompt).not.toContain("[extra]");
  });

  it("includes previous chat messages before the current question", () => {
    const prompt = buildResearchPrompt({
      question: "How should I configure it now?",
      chatHistory: [
        { role: "user", content: "I use Ollama with a small context model." },
        { role: "assistant", content: "Use shorter answers and cite local notes." },
      ],
      evidence: [],
      maxEvidenceItems: 2,
    });

    expect(prompt).toContain("Previous chat:");
    expect(prompt).toContain("User: I use Ollama with a small context model.");
    expect(prompt).toContain("Assistant: Use shorter answers and cite local notes.");
    expect(prompt).toContain("Question: How should I configure it now?");
  });
});

describe("extractFollowUpQuestions", () => {
  it("extracts numbered follow-up questions from a final model answer", () => {
    expect(
      extractFollowUpQuestions(`
        Answer text.

        Follow-up questions:
        1. Which notes should be indexed first?
        2. How often should I rebuild the index?
      `),
    ).toEqual(["Which notes should be indexed first?", "How often should I rebuild the index?"]);
  });
});

describe("ResearchService", () => {
  it("drops stale indexed skill chunks before evidence planning", async () => {
    const retriever = new FakeRetriever({
      chunks: [
        retrieved(
          "skill-chunk",
          markdownSource(".ixplorer/skills/rag-debugger/SKILL.md"),
          "Instruction body must not be evidence.",
        ),
        retrieved("note-chunk", markdownSource("Notes/Useful.md"), "Useful evidence."),
      ],
      citations: [
        citation("skill-chunk", markdownSource(".ixplorer/skills/rag-debugger/SKILL.md")),
        citation("note-chunk", markdownSource("Notes/Useful.md")),
      ],
      usedFallback: false,
    });
    const chatModel = new FakeChatModel();
    const service = new ResearchService({
      retriever,
      chatModel,
      chatModelName: "qwen",
      now: fixedNow,
    });

    const events = await collectAsync(service.answer({ question: "What is useful?" }));
    const complete = events.at(-1);

    expect(complete).toMatchObject({
      type: "complete",
      answer: {
        evidence: [expect.objectContaining({ id: "note-chunk" })],
        citations: [expect.objectContaining({ id: "note-chunk" })],
      },
    });
    expect(JSON.stringify(complete)).not.toContain("skill-chunk");
  });

  it("records ranked retrieval, dropped reasons, budget, and index status for RAG diagnostics", async () => {
    const retriever = new FakeRetriever({
      chunks: [
        { ...retrieved("top", markdownSource("Notes/Top.md"), "Top evidence."), score: 0.91 },
        { ...retrieved("low", markdownSource("Notes/Low.md"), "Low evidence."), score: 0.22 },
      ],
      citations: [
        citation("top", markdownSource("Notes/Top.md")),
        citation("low", markdownSource("Notes/Low.md")),
      ],
      usedFallback: false,
    });
    const chatModel = new FakeChatModel();
    const service = new ResearchService({
      retriever,
      chatModel,
      chatModelName: "qwen",
      evidenceLimit: 1,
      getIndexStatus: () => ({ status: "stale", available: true, isStale: true }),
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({ question: "Why did RAG miss a note?", includeContextDiagnostics: true }),
    );

    expect(events.at(-1)).toMatchObject({
      type: "complete",
      answer: {
        contextDiagnostics: {
          retrieval: {
            rankedChunks: [
              {
                id: "top",
                path: "Notes/Top.md",
                rank: 1,
                score: 0.91,
                status: "included",
              },
              {
                id: "low",
                path: "Notes/Low.md",
                rank: 2,
                score: 0.22,
                status: "dropped",
                reason: "evidence-planner",
              },
            ],
          },
          index: { status: "stale", available: true, isStale: true },
          budget: { groups: expect.any(Array) },
        },
      },
    });
    expect(chatModel.requests[0].messages[1].content).toContain("Retrieval diagnostics:");
    expect(chatModel.requests[0].messages[1].content).toContain('"rankedChunks"');
    expect(chatModel.requests[0].messages[1].content).toContain('"status":"stale"');
  });

  it("loads an explicitly mentioned skill inline for a model without tools", async () => {
    const registry = await createSkillRegistry();
    const chatModel = new FakeChatModel([
      { content: "Synthesized answer.", isComplete: false },
      { content: "", isComplete: true },
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      skillRegistry: registry,
      toolsEnabled: false,
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({
        question: "@note-synthesis Summarize these notes",
        includeContextDiagnostics: true,
      }),
    );

    expect(chatModel.requests).toHaveLength(1);
    expect(chatModel.requests[0].messages[0].content).toContain(
      "SKILL BODY: group findings by theme.",
    );
    expect(chatModel.requests[0].messages[1].content).toContain("Question: Summarize these notes");
    expect(chatModel.requests[0].messages[1].content).not.toContain("@note-synthesis");
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      answer: {
        contextDiagnostics: {
          skills: {
            discoveredCount: 1,
            selectedId: "note-synthesis",
            selectionMode: "manual",
            loadMode: "inline",
            loadStatus: "loaded",
            truncated: false,
          },
        },
      },
    });
  });

  it("uses a selector pass then inline loading for a model without tools", async () => {
    const registry = await createSkillRegistry();
    const chatModel = new FakeChatModel([
      [
        { content: '{"skill":"note-synthesis"}', isComplete: false },
        { content: "", isComplete: true },
      ],
      [
        { content: "Synthesized answer.", isComplete: false },
        { content: "", isComplete: true },
      ],
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      skillRegistry: registry,
      toolsEnabled: false,
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({ question: "Summarize these notes", includeContextDiagnostics: true }),
    );

    expect(chatModel.requests).toHaveLength(2);
    expect(chatModel.requests[0].messages[0].content).toContain("Return JSON only");
    expect(chatModel.requests[1].messages[0].content).toContain("SKILL BODY");
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      answer: {
        contextDiagnostics: {
          skills: {
            selectedId: "note-synthesis",
            selectionMode: "automatic",
            loadMode: "inline",
          },
        },
      },
    });
  });

  it("uses inline skill loading in web-only mode without exposing vault note tools", async () => {
    const registry = await createSkillRegistry();
    const chatModel = new FakeChatModel([
      [
        { content: '{"skill":"note-synthesis"}', isComplete: false },
        { content: "", isComplete: true },
      ],
      [{ content: "Web-only skill answer.", isComplete: true }],
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      toolsEnabled: true,
      skillRegistry: registry,
      now: fixedNow,
    });

    await collectAsync(
      service.answer({ question: "Summarize these sources", searchMode: "webOnly" }),
    );

    expect(chatModel.requests).toHaveLength(2);
    expect(chatModel.requests[1].tools).toBeUndefined();
    expect(chatModel.requests[1].messages[0].content).toContain("SKILL BODY");
  });

  it("lets compatible models read notes through the optional tool loop", async () => {
    const chatModel = new FakeChatModel([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [
            {
              id: "call-1",
              name: "read_note",
              arguments: { path: "Research/Tool.md" },
            },
          ],
        },
      ],
      [
        {
          content: "Tool answer uses note context.",
          isComplete: false,
        },
        { content: "", isComplete: true },
      ],
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      toolsEnabled: true,
      noteTools: new NoteToolService({
        files: new MemoryContextFiles({
          "Research/Tool.md": "# Tool\n\nPrivate tool context.",
        }),
        extractors: [new MarkdownExtractor()],
      }),
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({
        question: "Read the tool note.",
        includeContextDiagnostics: true,
      }),
    );

    expect(events.map((event) => event.type)).toEqual(["status", "status", "delta", "complete"]);
    expect(chatModel.requests).toHaveLength(2);
    expect(chatModel.requests[0].tools?.map((tool) => tool.function.name)).toContain("read_note");
    expect(chatModel.requests[1].messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
    });
    expect(chatModel.requests[1].messages.at(-1)?.content).toContain("Private tool context");
    expect(events.at(-1)).toEqual({
      type: "complete",
      answer: expect.objectContaining({
        answer: "Tool answer uses note context.",
        contextDiagnostics: expect.objectContaining({
          tools: [
            expect.objectContaining({
              id: "call-1",
              name: "read_note",
              status: "success",
            }),
          ],
        }),
      }),
    });
  });

  it("lets a tool-capable model select and load a catalog skill through read_note", async () => {
    const registry = await createSkillRegistry();
    const skillPath = ".ixplorer/skills/note-synthesis/SKILL.md";
    const chatModel = new FakeChatModel([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [
            {
              id: "call-skill",
              name: "read_note",
              arguments: { path: skillPath },
            },
          ],
        },
      ],
      [
        { content: "Skill-guided answer.", isComplete: false },
        { content: "", isComplete: true },
      ],
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      toolsEnabled: true,
      skillRegistry: registry,
      noteTools: new NoteToolService({
        files: new MemoryContextFiles({}),
        extractors: [new MarkdownExtractor()],
        skillRegistry: registry,
      }),
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({ question: "Summarize these notes", includeContextDiagnostics: true }),
    );

    expect(chatModel.requests[0].messages[0].content).toContain(skillPath);
    expect(chatModel.requests[1].messages.at(-1)?.content).toContain(
      "SKILL BODY: group findings by theme.",
    );
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      answer: {
        contextDiagnostics: {
          skills: {
            selectedId: "note-synthesis",
            selectionMode: "automatic",
            loadMode: "read_note",
            loadStatus: "loaded",
            truncated: false,
          },
        },
      },
    });
  });

  it("rejects tool output that loads more than one skill", async () => {
    const first = await createSkillRegistry();
    const snapshot = await first.getSnapshot();
    const baseStore = new Map([
      [snapshot.skills[0].path, (await first.load(snapshot.skills[0])).content],
      [
        ".ixplorer/skills/rag-debugger/SKILL.md",
        "---\nname: RAG Debugger\ndescription: Debug RAG.\n---\n# RAG Debugger",
      ],
    ]);
    const store: SkillFileStore = {
      exists: async (path) =>
        path === ".ixplorer/skills" ||
        path === ".ixplorer/skills/note-synthesis" ||
        path === ".ixplorer/skills/rag-debugger" ||
        baseStore.has(path),
      list: async () => ({
        files: [],
        folders: [".ixplorer/skills/note-synthesis", ".ixplorer/skills/rag-debugger"],
      }),
      read: async (path) => baseStore.get(path) ?? "",
      write: async () => undefined,
      mkdir: async () => undefined,
    };
    const registry = new SkillRegistry({ store, defaults: [] });
    await registry.refresh();
    const chatModel = new FakeChatModel([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: registrySnapshotCalls(await registry.getSnapshot()),
        },
      ],
      [{ content: "Invalid multi-skill answer.", isComplete: true }],
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      toolsEnabled: true,
      skillRegistry: registry,
      noteTools: new NoteToolService({
        files: new MemoryContextFiles({}),
        extractors: [new MarkdownExtractor()],
        skillRegistry: registry,
      }),
      now: fixedNow,
    });

    await expect(collectAsync(service.answer({ question: "Use skills" }))).rejects.toMatchObject({
      code: "INVALID_SKILL_SELECTION",
    });
  });

  it("retrieves evidence, adds optional multi-result web evidence, reports status, and streams the answer", async () => {
    const retriever = new FakeRetriever({
      chunks: [retrieved("local-1", markdownSource("Research/local.md"), "Local model notes")],
      citations: [citation("local-1", markdownSource("Research/local.md"), "Research/local.md")],
      usedFallback: false,
    });
    const webSearch = new FakeSearchProvider([
      {
        source: webSource("https://example.com/local-models"),
        extractedText: "Web article text",
        rank: 1,
        query: "How should I use local models?",
      },
      {
        source: webSource("https://example.com/second"),
        extractedText: "Second web article text",
        rank: 2,
        query: "How should I use local models?",
      },
    ]);
    const chatModel = new FakeChatModel([
      { content: "Use local models with citations [local-1].\n\n", isComplete: false },
      { content: "Follow-up questions:\n1. What should I index next?", isComplete: false },
      { content: "", isComplete: true },
    ]);
    const persisted: unknown[] = [];
    const service = new ResearchService({
      retriever,
      searchProvider: webSearch,
      chatModel,
      chatModelName: "qwen",
      now: fixedNow,
      persistFinalAnswer: (answer) => {
        persisted.push(answer);
      },
    });

    const events = await collectAsync(
      service.answer({
        question: "How should I use local models?",
        includeWebSearch: true,
      }),
    );

    expect(events).toEqual([
      { type: "status", message: "Reading vault context..." },
      { type: "status", message: "Searching web..." },
      { type: "status", message: "Fetching sources..." },
      { type: "status", message: "Synthesizing answer..." },
      { type: "delta", content: "Use local models with citations [local-1].\n\n" },
      { type: "delta", content: "Follow-up questions:\n1. What should I index next?" },
      {
        type: "complete",
        answer: {
          question: "How should I use local models?",
          answer:
            "Use local models with citations [local-1].\n\nFollow-up questions:\n1. What should I index next?",
          citations: [
            expect.objectContaining({ id: "local-1" }),
            expect.objectContaining({ id: "web:https://example.com/local-models" }),
            expect.objectContaining({ id: "web:https://example.com/second" }),
          ],
          evidence: [
            expect.objectContaining({ id: "local-1", text: "Local model notes" }),
            expect.objectContaining({
              id: "web:https://example.com/local-models",
              text: "Web article text",
            }),
            expect.objectContaining({
              id: "web:https://example.com/second",
              text: "Second web article text",
            }),
          ],
          followUpQuestions: ["What should I index next?"],
          createdAt: "2026-05-16T00:00:00.000Z",
        },
      },
    ]);
    expect(retriever.requests).toEqual([
      {
        query: "How should I use local models?",
        options: { limit: 8, includeWebResults: false },
      },
    ]);
    expect(webSearch.requests).toEqual([
      {
        query: "How should I use local models?",
        options: { limit: 5, maxFetches: 3 },
      },
    ]);
    expect(chatModel.requests[0]).toMatchObject({
      model: "qwen",
      temperature: 0.2,
    });
    expect(chatModel.requests[0].messages[1].content).toContain("[local-1] Research/local.md");
    expect(chatModel.requests[0].messages[1].content).toContain(
      "[web:https://example.com/local-models] Example",
    );
    expect(persisted).toEqual([
      expect.objectContaining({ question: "How should I use local models?" }),
    ]);
  });

  it("does not persist intermediate research state while streaming", async () => {
    const persistFinalAnswer = vi.fn();
    const service = new ResearchService({
      retriever: new FakeRetriever({
        chunks: [retrieved("local-1", markdownSource("Research/local.md"), "Local model notes")],
        citations: [citation("local-1", markdownSource("Research/local.md"), "Research/local.md")],
        usedFallback: false,
      }),
      chatModel: new FakeChatModel([
        { content: "First ", isComplete: false },
        { content: "second", isComplete: false },
        { content: "", isComplete: true },
      ]),
      chatModelName: "qwen",
      persistFinalAnswer,
      now: fixedNow,
    });

    const iterator = service
      .answer({ question: "What is local retrieval?" })
      [Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.value).toEqual({ type: "status", message: "Reading vault context..." });
    expect(persistFinalAnswer).not.toHaveBeenCalled();

    await iterator.next();
    const firstDelta = await iterator.next();
    await iterator.next();
    const done = await iterator.next();

    expect(firstDelta.value).toEqual({ type: "delta", content: "First " });
    expect(done.value).toEqual({
      type: "complete",
      answer: expect.objectContaining({ answer: "First second" }),
    });
    expect(persistFinalAnswer).toHaveBeenCalledTimes(1);
  });

  it("refuses to call the model when chat history exceeds the configured context window", async () => {
    const chatModel = new FakeChatModel([{ content: "Answer.", isComplete: true }]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      chatModel,
      chatModelName: "qwen",
      contextLimitTokens: 20,
      now: fixedNow,
    });

    await expect(
      collectAsync(
        service.answer({
          question: "Continue with the same plan.",
          chatHistory: [
            { role: "user", content: "A long prior message ".repeat(20) },
            { role: "assistant", content: "A long prior answer ".repeat(20) },
          ],
        }),
      ),
    ).rejects.toThrow("The current chat is too long for the selected model context window.");
    expect(chatModel.requests).toEqual([]);
  });

  it("uses language-aware query variants for vault retrieval without sending vault evidence to expansion", async () => {
    const privateVaultText = "Private vault evidence should not be in expansion prompt";
    const retriever = new FakeRetriever(
      {
        chunks: [retrieved("local-1", markdownSource("Research/local.md"), privateVaultText)],
        citations: [citation("local-1", markdownSource("Research/local.md"), "Research/local.md")],
        usedFallback: false,
      },
      [{ language: "en", chunkCount: 4, sourceCount: 1 }],
    );
    const chatModel = new FakeChatModel([
      [
        {
          content:
            '{"queries":[{"query":"sorting algorithms advantages disadvantages","language":"en","reason":"translated"}]}',
          isComplete: true,
        },
      ],
      [{ content: "Answer.", isComplete: true }],
    ]);
    const service = new ResearchService({
      retriever,
      chatModel,
      chatModelName: "qwen",
      queryExpansion: new QueryExpansionService({ chatModel, chatModelName: "qwen" }),
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({
        question: "методы сортировки плюсы минусы",
        searchMode: "indexOnly",
        includeContextDiagnostics: true,
      }),
    );

    expect(retriever.requests[0].options.queryVariants).toEqual([
      {
        query: "sorting algorithms advantages disadvantages",
        language: "en",
        reason: "translated",
      },
    ]);
    expect(chatModel.requests[0].messages[1].content).not.toContain(privateVaultText);
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      answer: {
        contextDiagnostics: {
          retrieval: {
            queryVariants: ["sorting algorithms advantages disadvantages"],
          },
        },
      },
    });
  });

  it("skips local index retrieval when search mode is web only", async () => {
    const retriever = new FakeRetriever({
      chunks: [retrieved("local-1", markdownSource("Research/local.md"), "Local model notes")],
      citations: [citation("local-1", markdownSource("Research/local.md"), "Research/local.md")],
      usedFallback: false,
    });
    const webSearch = new FakeSearchProvider([
      {
        source: webSource("https://example.com/current-docs"),
        extractedText: "Current web documentation",
        rank: 1,
        query: "What changed recently?",
      },
    ]);
    const chatModel = new FakeChatModel([{ content: "Use the web citation.", isComplete: true }]);
    const service = new ResearchService({
      retriever,
      searchProvider: webSearch,
      chatModel,
      chatModelName: "qwen",
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({
        question: "What changed recently?",
        searchMode: "webOnly",
        contextPaths: ["Research/local.md"],
      }),
    );

    expect(retriever.requests).toEqual([]);
    expect(webSearch.requests).toEqual([
      { query: "What changed recently?", options: { limit: 5, maxFetches: 3 } },
    ]);
    expect(events.at(-1)).toEqual({
      type: "complete",
      answer: expect.objectContaining({
        citations: [expect.objectContaining({ id: "web:https://example.com/current-docs" })],
        evidence: [
          expect.objectContaining({
            id: "web:https://example.com/current-docs",
            text: "Current web documentation",
          }),
        ],
      }),
    });
    expect(chatModel.requests[0].messages[1].content).toContain(
      "[web:https://example.com/current-docs] Example",
    );
    expect(chatModel.requests[0].messages[1].content).not.toContain("Local model notes");
  });

  it("builds deep web queries from the typed question and combines them with vault evidence", async () => {
    const privateVaultText = "Private vault context that must not appear in the plan";
    const retriever = new FakeRetriever({
      chunks: [retrieved("local-1", markdownSource("Research/local.md"), privateVaultText)],
      citations: [citation("local-1", markdownSource("Research/local.md"), "Research/local.md")],
      usedFallback: false,
    });
    const webSearch = new FakeSearchProvider([
      {
        source: webSource("https://example.com/a"),
        extractedText: "Alpha local model research",
        rank: 1,
        query: "local model research",
      },
      {
        source: webSource("https://example.com/b?utm_source=x"),
        extractedText: "Beta current documentation",
        rank: 1,
        query: "current local model documentation",
      },
      {
        source: webSource("https://example.com/b"),
        extractedText: "Duplicate beta documentation",
        rank: 2,
        query: "current local model documentation",
      },
    ]);
    const chatModel = new FakeChatModel([
      [
        {
          content: '{"queries":["local model research","current local model documentation"]}',
          isComplete: true,
        },
      ],
      [{ content: "Deep answer [local-1] [web:https://example.com/a]", isComplete: true }],
    ]);
    const service = new ResearchService({
      retriever,
      searchProvider: webSearch,
      chatModel,
      chatModelName: "qwen",
      now: fixedNow,
    });

    const events = await collectAsync(
      service.answer({
        question: "How should I research local models?",
        searchMode: "indexAndWeb",
        deepResearch: true,
      }),
    );

    expect(events.map((event) => (event.type === "status" ? event.message : event.type))).toEqual([
      "Reading vault context...",
      "Planning web queries...",
      "Searching web...",
      "Fetching sources...",
      "Synthesizing answer...",
      "delta",
      "complete",
    ]);
    expect(chatModel.requests[0].messages[1].content).toContain(
      "Question: How should I research local models?",
    );
    expect(chatModel.requests[0].messages[1].content).not.toContain(privateVaultText);
    expect(webSearch.requests).toEqual([
      { query: "local model research", options: { limit: 5, maxFetches: 5 } },
      { query: "current local model documentation", options: { limit: 5, maxFetches: 5 } },
    ]);
    expect(events.at(-1)).toEqual({
      type: "complete",
      answer: expect.objectContaining({
        evidence: expect.arrayContaining([
          expect.objectContaining({ id: "local-1", text: privateVaultText }),
          expect.objectContaining({ id: "web:https://example.com/a" }),
          expect.objectContaining({ id: "web:https://example.com/b?utm_source=x" }),
        ]),
      }),
    });
  });

  it("keeps deep web evidence when local retrieval fills the evidence limit", async () => {
    const localChunks = Array.from({ length: 8 }, (_, index) =>
      retrieved(
        `local-${index + 1}`,
        markdownSource(`OSINT/page-${index + 1}.md`),
        `Unrelated OSINT evidence ${index + 1}`,
      ),
    );
    const retriever = new FakeRetriever({
      chunks: localChunks,
      citations: localChunks.map((chunk) => citation(chunk.id, chunk.source, chunk.source.title)),
      usedFallback: false,
    });
    const webSearch = new FakeSearchProvider([
      {
        source: webSource("https://example.com/sorting-algorithms"),
        extractedText:
          "Sorting algorithms include quicksort, mergesort, heapsort, and insertion sort.",
        rank: 1,
        query: "sorting algorithms advantages disadvantages",
      },
    ]);
    const chatModel = new FakeChatModel([
      [
        {
          content: '{"queries":["sorting algorithms advantages disadvantages"]}',
          isComplete: true,
        },
      ],
      [
        {
          content: "Sorting answer [web:https://example.com/sorting-algorithms]",
          isComplete: true,
        },
      ],
    ]);
    const service = new ResearchService({
      retriever,
      searchProvider: webSearch,
      chatModel,
      chatModelName: "granite",
      now: fixedNow,
    });

    await collectAsync(
      service.answer({
        question: "выполни исследование на тему: методы сортировки их плюсы и минусы",
        searchMode: "indexAndWeb",
        deepResearch: true,
      }),
    );

    const synthesisPrompt = chatModel.requests[1].messages[1].content;

    expect(synthesisPrompt).toContain("[web:https://example.com/sorting-algorithms] Example");
    expect(synthesisPrompt).toContain("Sorting algorithms include quicksort");
  });

  it("falls back to normal multi-result web search when deep planning is invalid", async () => {
    const webSearch = new FakeSearchProvider([
      {
        source: webSource("https://example.com/fallback"),
        extractedText: "Fallback web result",
        rank: 1,
        query: "What changed recently?",
      },
    ]);
    const chatModel = new FakeChatModel([
      [{ content: "I cannot make JSON.", isComplete: true }],
      [{ content: "Fallback answer.", isComplete: true }],
    ]);
    const service = new ResearchService({
      retriever: new FakeRetriever(emptyRetrieval()),
      searchProvider: webSearch,
      chatModel,
      chatModelName: "qwen",
      now: fixedNow,
    });

    await collectAsync(
      service.answer({
        question: "What changed recently?",
        searchMode: "webOnly",
        deepResearch: true,
      }),
    );

    expect(webSearch.requests).toEqual([
      { query: "What changed recently?", options: { limit: 5, maxFetches: 5 } },
    ]);
  });
});
