import { RetrievalResult } from "../../src/retrieval/RetrievalService";
import { ResearchService } from "../../src/research/ResearchService";
import { QueryExpansionService } from "../../src/retrieval/QueryExpansionService";
import { buildResearchPrompt, extractFollowUpQuestions } from "../../src/research/prompts";
import {
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
  Citation,
  LanguageInventoryItem,
  RetrievedChunk,
  SearchProvider,
  SearchProviderResult,
  SourceReference,
  WebSourceReference,
} from "../../src/shared/types";

describe("buildResearchPrompt", () => {
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

    const events = await collect(
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

    await collect(
      service.answer({
        question: "методы сортировки плюсы минусы",
        searchMode: "indexOnly",
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

    const events = await collect(
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

    const events = await collect(
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

    await collect(
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

    await collect(
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

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

function retrieved(id: string, source: SourceReference, text: string): RetrievedChunk {
  return { id, source, text, score: 0.8, contentHash: `hash-${id}` };
}

function citation(id: string, source: SourceReference, label: string): Citation {
  return { id, source, label };
}

function markdownSource(path: string): SourceReference {
  return {
    id: `source-${path}`,
    kind: "markdown",
    title: path,
    path,
    headingPath: [],
  };
}

function pdfSource(path: string, pageNumber: number): SourceReference {
  return {
    id: `source-${path}`,
    kind: "pdf",
    title: path,
    path,
    pageNumber,
  };
}

function webSource(url: string): WebSourceReference {
  return {
    id: `web:${url}`,
    kind: "web",
    title: "Example",
    url,
    snippet: "Example snippet",
    retrievedAt: "2026-05-16T00:00:00.000Z",
    wasContentFetched: true,
  };
}

function fixedNow(): Date {
  return new Date("2026-05-16T00:00:00.000Z");
}

class FakeRetriever {
  readonly requests: Array<{
    query: string;
    options: {
      limit: number;
      includeWebResults: boolean;
      sourcePaths?: string[];
      queryVariants?: unknown;
    };
  }> = [];

  constructor(
    private readonly result: RetrievalResult,
    private readonly languageInventory: LanguageInventoryItem[] = [],
  ) {}

  async search(
    query: string,
    options: {
      limit: number;
      includeWebResults: boolean;
      sourcePaths?: string[];
      queryVariants?: unknown;
    },
  ): Promise<RetrievalResult> {
    this.requests.push({ query, options });
    return this.result;
  }

  async getLanguageInventory(): Promise<LanguageInventoryItem[]> {
    return this.languageInventory;
  }
}

class FakeSearchProvider implements SearchProvider {
  readonly requests: Array<{ query: string; options: unknown }> = [];

  constructor(private readonly results: SearchProviderResult[]) {}

  async search(query: string, options: unknown): Promise<SearchProviderResult[]> {
    this.requests.push({ query, options });
    return this.results.filter((result) => result.query === query);
  }
}

class FakeChatModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  constructor(private readonly chunks: ChatResponseChunk[] | ChatResponseChunk[][]) {}

  async listModels(): Promise<string[]> {
    return ["qwen"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const chunks = Array.isArray(this.chunks[0])
      ? ((this.chunks as ChatResponseChunk[][])[this.requests.length - 1] ?? [])
      : (this.chunks as ChatResponseChunk[]);

    for (const chunk of chunks) {
      yield chunk;
    }
  }
}

function emptyRetrieval(): RetrievalResult {
  return {
    chunks: [],
    citations: [],
    usedFallback: false,
  };
}
