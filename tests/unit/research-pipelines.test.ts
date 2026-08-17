import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryExpansionService } from "@adapters/retrieval";
import { runToolLoop } from "@adapters/research-tools";
import { AnswerSynthesisService } from "@application/use-cases/research/AnswerSynthesisService";
import { VaultResearchPipeline } from "@application/use-cases/research/VaultResearchPipeline";
import { WebResearchPipeline } from "@application/use-cases/research/WebResearchPipeline";
import { collectAsync } from "../helpers/async";
import { citation, fixedNow, markdownSource, retrieved, webSource } from "../helpers/factories";
import { FakeChatModel, FakeRetriever, FakeSearchProvider } from "../helpers/researchFakes";

describe("VaultResearchPipeline", () => {
  it("expands vault query variants when language inventory is available", async () => {
    const retriever = new FakeRetriever(
      {
        chunks: [],
        citations: [],
        usedFallback: false,
      },
      [{ language: "en", chunkCount: 3, sourceCount: 1 }],
    );
    const chatModel = new FakeChatModel([
      {
        content:
          '{"queries":[{"query":"local first research assistant","language":"en","reason":"translated"}]}',
        isComplete: true,
      },
    ]);
    const pipeline = new VaultResearchPipeline({
      retriever,
      queryExpansion: new QueryExpansionService({ chatModel, chatModelName: "qwen" }),
      evidenceLimit: 4,
    });

    const events = await collectAsync(
      pipeline.search("локальный research assistant", ["Notes/a.md"]),
    );

    expect(events).toEqual([
      { type: "status", message: "Reading vault context..." },
      { type: "status", message: "Expanding search queries..." },
    ]);
    expect(retriever.requests).toHaveLength(1);
    expect(retriever.requests[0]!.query).toBe("локальный research assistant");
    expect(retriever.requests[0]!.options).toMatchObject({
      limit: 4,
      includeWebResults: false,
      sourcePaths: ["Notes/a.md"],
    });
    await expect(retriever.requests[0]!.options.queryVariants).resolves.toEqual([
      {
        query: "local first research assistant",
        language: "en",
        reason: "translated",
      },
    ]);
  });

  it("starts the original-query search without waiting for query expansion", async () => {
    const retriever = new FakeRetriever({ chunks: [], citations: [], usedFallback: false }, [
      { language: "en", chunkCount: 3, sourceCount: 1 },
    ]);
    let releaseExpansion: (() => void) | undefined;
    const expansionStarted = new Promise<void>((resolve) => {
      releaseExpansion = resolve;
    });
    const pipeline = new VaultResearchPipeline({
      retriever,
      queryExpansion: {
        buildVariants: async () => {
          await expansionStarted;
          return [{ query: "variant" }];
        },
      },
      evidenceLimit: 4,
    });

    const run = collectAsync(pipeline.search("question", undefined));
    await tick();

    expect(retriever.requests).toHaveLength(1);

    releaseExpansion!();
    await run;
  });

  it("keeps answering when query expansion fails", async () => {
    const retriever = new FakeRetriever({ chunks: [], citations: [], usedFallback: false }, [
      { language: "en", chunkCount: 3, sourceCount: 1 },
    ]);
    const pipeline = new VaultResearchPipeline({
      retriever,
      queryExpansion: {
        buildVariants: async () => {
          throw new Error("expansion unavailable");
        },
      },
      evidenceLimit: 4,
    });

    await collectAsync(pipeline.search("question", undefined));

    expect(retriever.requests).toHaveLength(1);
    await expect(retriever.requests[0]!.options.queryVariants).resolves.toBeUndefined();
  });

  it("passes the turn signal to the retriever and to query expansion", async () => {
    const retriever = new FakeRetriever({ chunks: [], citations: [], usedFallback: false }, [
      { language: "en", chunkCount: 3, sourceCount: 1 },
    ]);
    const controller = new AbortController();
    let expansionSignal: AbortSignal | undefined;
    const pipeline = new VaultResearchPipeline({
      retriever,
      queryExpansion: {
        buildVariants: async (request) => {
          expansionSignal = request.signal;
          return [];
        },
      },
      evidenceLimit: 4,
    });

    await collectAsync(
      pipeline.search("question", undefined, ["Linked.md"], { signal: controller.signal }),
    );

    expect(expansionSignal).toBe(controller.signal);
    expect(retriever.requests).toHaveLength(1);
    expect(retriever.requests[0]!.options.signal).toBe(controller.signal);
  });

  it("passes boosted source paths to a single index search", async () => {
    const retriever = new FakeRetriever({ chunks: [], citations: [], usedFallback: false }, []);
    const pipeline = new VaultResearchPipeline({ retriever, evidenceLimit: 4 });

    await collectAsync(pipeline.search("question", ["Notes/main.md"], ["Linked.md"]));

    expect(retriever.requests).toHaveLength(1);
    expect(retriever.requests[0]!.options).toMatchObject({
      sourcePaths: ["Notes/main.md"],
      boostedSourcePaths: ["Linked.md"],
    });
  });

  it("omits boosted source paths when none were requested", async () => {
    const retriever = new FakeRetriever({ chunks: [], citations: [], usedFallback: false }, []);
    const pipeline = new VaultResearchPipeline({ retriever, evidenceLimit: 4 });

    await collectAsync(pipeline.search("question", undefined, []));

    expect(retriever.requests).toHaveLength(1);
    expect(retriever.requests[0]!.options.boostedSourcePaths).toBeUndefined();
  });

  it("returns evidence and citations the retriever ranked for boosted source paths", async () => {
    const retriever = new FakeRetriever((options) =>
      options.boostedSourcePaths?.includes("Linked.md")
        ? retrievalOf(["g1", "p1", "p2"], "Linked.md")
        : retrievalOf(["p1", "p2", "p3", "p4"], "Notes/main.md"),
    );
    const pipeline = new VaultResearchPipeline({ retriever, evidenceLimit: 4 });

    const generator = pipeline.search("question", undefined, ["Linked.md"]);
    let step = await generator.next();
    while (!step.done) {
      step = await generator.next();
    }

    expect(step.value.chunks.map((chunk) => chunk.id)).toEqual(["g1", "p1", "p2"]);
    expect(step.value.citations.map((entry) => entry.id)).toEqual(["g1", "p1", "p2"]);
  });

  it("yields no vault evidence and no status when composed without a retriever", async () => {
    const pipeline = new VaultResearchPipeline({ evidenceLimit: 4 });

    const generator = pipeline.search("question", undefined, []);
    const step = await generator.next();

    expect(step.done).toBe(true);
    expect(step.value).toEqual({ chunks: [], citations: [], usedFallback: false });
  });
});

describe("WebResearchPipeline", () => {
  it("reports direct queries and processing decisions for every web result", async () => {
    const primary = webSource("https://example.com/article?utm_source=test");
    const duplicate = webSource("https://example.com/article");
    const limited = webSource("https://example.com/limited");
    const searchProvider = new FakeSearchProvider([
      {
        source: primary,
        extractedText: "Fetched article text",
        rank: 1,
        query: "public research",
      },
      {
        source: duplicate,
        rank: 2,
        query: "public research",
      },
      {
        source: limited,
        rank: 3,
        query: "public research",
      },
    ]);
    const pipeline = new WebResearchPipeline({
      searchProvider,
      evidenceLimit: 1,
    });

    const generator = pipeline.search("public research", true);
    let step = await generator.next();
    while (!step.done) {
      step = await generator.next();
    }

    expect(step.value.diagnostics).toMatchObject({
      originalQuestion: "public research",
      queryStrategy: "direct",
      queries: ["public research"],
      requests: [{ query: "public research", limit: 20, maxFetches: 3 }],
      finalPrompt: { includedChunkIds: [], usedTokens: 0 },
      results: [
        {
          chunkId: primary.id,
          query: "public research",
          url: primary.url,
          providerRank: 1,
          processingRank: 1,
          wasContentFetched: true,
          textSource: "fetched-content",
          textPreview: "Fetched article text",
          status: "candidate",
        },
        {
          chunkId: duplicate.id,
          query: "public research",
          url: duplicate.url,
          providerRank: 2,
          wasContentFetched: true,
          textSource: "search-snippet",
          textPreview: duplicate.snippet,
          status: "dropped",
          reason: "canonical-duplicate-url",
        },
        {
          chunkId: limited.id,
          processingRank: 2,
          status: "dropped",
          reason: "web-evidence-limit",
        },
      ],
    });
  });

  it("prefers fetched canonical duplicates and fills the released evidence slot", async () => {
    const mobileSnippet = webSource("https://m.example.com/cheesecake/amp/");
    mobileSnippet.wasContentFetched = false;
    mobileSnippet.snippet = "Cheesecake recipe preview";
    const fetchedDesktop = webSource("https://www.example.com/cheesecake?utm_source=search");
    fetchedDesktop.snippet = "Short preview";
    const nextUnique = webSource("https://news.example.com/cheesecake-guide");
    nextUnique.wasContentFetched = false;
    nextUnique.snippet = "Cheesecake guide with practical recipe details";
    const searchProvider = new FakeSearchProvider([
      {
        source: mobileSnippet,
        rank: 1,
        query: "cheesecake recipe",
      },
      {
        source: fetchedDesktop,
        extractedText: "Complete cheesecake recipe with ingredients and cooking instructions.",
        rank: 6,
        query: "cheesecake recipe",
      },
      {
        source: nextUnique,
        rank: 7,
        query: "cheesecake recipe",
      },
    ]);
    const pipeline = new WebResearchPipeline({ searchProvider, evidenceLimit: 2 });

    const result = await completedValue(pipeline.search("cheesecake recipe", true));

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks.map((chunk) => chunk.id)).toContain(fetchedDesktop.id);
    expect(result.chunks.map((chunk) => chunk.id)).toContain(nextUnique.id);
    expect(result.chunks.map((chunk) => chunk.id)).not.toContain(mobileSnippet.id);
    expect(result.diagnostics?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chunkId: mobileSnippet.id,
          status: "dropped",
          reason: "canonical-duplicate-url",
        }),
        expect.objectContaining({
          chunkId: fetchedDesktop.id,
          processingRank: 1,
          status: "candidate",
        }),
        expect.objectContaining({
          chunkId: nextUnique.id,
          processingRank: 2,
          status: "candidate",
        }),
      ]),
    );
  });

  it("falls back from unreadable fetched content to a readable search snippet", async () => {
    const source = webSource("https://example.com/readable-fallback");
    source.snippet = "Readable search preview with cheesecake instructions.";
    const searchProvider = new FakeSearchProvider([
      {
        source,
        extractedText: decodedInvalidUtf8Fixture(),
        rank: 1,
        query: "cheesecake instructions",
      },
    ]);
    const pipeline = new WebResearchPipeline({ searchProvider, evidenceLimit: 1 });

    const result = await completedValue(pipeline.search("cheesecake instructions", true));

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toMatchObject({
      id: source.id,
      text: source.snippet,
      source: { wasContentFetched: false },
    });
    expect(result.diagnostics?.results[0]).toMatchObject({
      chunkId: source.id,
      status: "candidate",
      textSource: "search-snippet",
      contentFallbackReason: "unreadable-fetched-content",
    });
  });

  it("drops a fully unreadable result and fills its slot with the next candidate", async () => {
    const unreadable = webSource("https://example.com/broken");
    const mojibake = decodedInvalidUtf8Fixture();
    unreadable.snippet = mojibake;
    const replacement = webSource("https://example.com/replacement");
    replacement.wasContentFetched = false;
    replacement.snippet = "Readable replacement evidence for the cheesecake recipe.";
    const searchProvider = new FakeSearchProvider([
      {
        source: unreadable,
        extractedText: mojibake,
        rank: 1,
        query: "cheesecake recipe",
      },
      {
        source: replacement,
        rank: 2,
        query: "cheesecake recipe",
      },
    ]);
    const pipeline = new WebResearchPipeline({ searchProvider, evidenceLimit: 1 });

    const result = await completedValue(pipeline.search("cheesecake recipe", true));

    expect(result.chunks.map((chunk) => chunk.id)).toEqual([replacement.id]);
    expect(result.diagnostics?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chunkId: unreadable.id,
          status: "dropped",
          reason: "unreadable-web-content",
        }),
        expect.objectContaining({
          chunkId: replacement.id,
          processingRank: 1,
          status: "candidate",
        }),
      ]),
    );
  });
});

describe("AnswerSynthesisService", () => {
  it("appends the partial-results notice so the cacheable system prompt prefix is stable", async () => {
    const chatModel = new FakeChatModel();
    const service = new AnswerSynthesisService({
      runToolLoop,
      chatModel,
      chatModelName: "qwen",
      chatOptions: {},
      now: fixedNow,
    });
    const request = { question: "Why?", evidence: [], citations: [], evidenceLimit: 8 };

    await collectAsync(service.synthesize(request));
    await collectAsync(
      service.synthesize({ ...request, fallback: { reason: "tool-loop-exhausted" } }),
    );

    const [complete, partial] = chatModel.requests.map(
      (chatRequest) => chatRequest.messages[0]!.content,
    );
    expect(partial!.startsWith(complete!)).toBe(true);
    expect(partial).toContain("PARTIAL results");
  });

  it("uses Responses rounds for instant synthesis without adding summaries to the final answer", async () => {
    const chatModel = new FakeChatModel([]);
    const service = new AnswerSynthesisService({
      runToolLoop,
      chatModel,
      modelRound: {
        listModels: async () => ["gpt-5"],
        runRound: async (request) => {
          request.onDelta?.({ type: "reasoningSummary", text: "summary-sentinel" });
          request.onDelta?.({ type: "text", text: "Final answer" });
          return {
            items: [
              { type: "reasoningSummary", text: "summary-sentinel" },
              { type: "text", text: "Final answer" },
            ],
            stopReason: "complete",
            reasoningItemCount: 1,
          };
        },
      },
      reasoning: { enabled: true, summary: "auto" },
      chatModelName: "gpt-5",
      chatOptions: {},
      now: fixedNow,
    });

    const events = await collectAsync(
      service.synthesize({ question: "Why?", evidence: [], citations: [], evidenceLimit: 8 }),
    );
    expect(events).toContainEqual({
      type: "reasoning",
      segmentId: "reasoning-0",
      content: "summary-sentinel",
    });
    expect(events).toContainEqual({ type: "delta", content: "Final answer" });
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({ answer: { answer: "Final answer" } });
    expect(JSON.stringify(complete)).not.toContain("summary-sentinel");
    expect(chatModel.requests).toEqual([]);
  });

  it("releases Responses text and reasoning deltas before the terminal event", async () => {
    let finishRound!: () => void;
    const roundFinished = new Promise<void>((resolve) => (finishRound = resolve));
    const service = new AnswerSynthesisService({
      runToolLoop,
      chatModel: new FakeChatModel([]),
      modelRound: {
        listModels: async () => ["gpt-5"],
        runRound: async (request) => {
          request.onDelta?.({
            type: "reasoningSummary",
            segmentId: "reasoning-live",
            text: "Inspecting constraints...",
          });
          request.onDelta?.({ type: "text", text: "Streaming answer" });
          await roundFinished;
          return {
            items: [{ type: "text", text: "Streaming answer" }],
            stopReason: "complete",
          };
        },
      },
      reasoning: { enabled: true, summary: "auto" },
      chatModelName: "gpt-5",
      chatOptions: {},
      now: fixedNow,
    });
    const stream = service
      .synthesize({ question: "Why?", evidence: [], citations: [], evidenceLimit: 8 })
      [Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: "status", message: "Synthesizing answer..." },
    });
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: {
        type: "reasoning",
        segmentId: "reasoning-live",
        content: "Inspecting constraints...",
      },
    });
    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: "delta", content: "Streaming answer" },
    });
    finishRound();
    while (!(await stream.next()).done) {}
  });

  it("streams deltas and completes with a persisted research answer", async () => {
    const persisted: unknown[] = [];
    const chatModel = new FakeChatModel([
      { content: "Answer [local-1].\n\n", isComplete: false },
      { content: "Follow-up questions:\n1. What next?", isComplete: true },
    ]);
    const service = new AnswerSynthesisService({
      runToolLoop,
      chatModel,
      chatModelName: "qwen",
      chatOptions: { temperature: 0.2 },
      now: fixedNow,
      persistFinalAnswer: (answer) => {
        persisted.push(answer);
      },
    });
    const source = markdownSource("Research/local.md");
    const citations = [citation("local-1", source)];

    const events = await collectAsync(
      service.synthesize({
        question: "How?",
        evidence: [retrieved("local-1", source, "Local evidence")],
        citations,
        evidenceLimit: 8,
      }),
    );

    expect(events).toEqual([
      { type: "status", message: "Synthesizing answer..." },
      { type: "delta", content: "Answer [local-1].\n\n" },
      { type: "delta", content: "Follow-up questions:\n1. What next?" },
      {
        type: "complete",
        answer: {
          question: "How?",
          answer: "Answer [local-1].\n\nFollow-up questions:\n1. What next?",
          citations,
          evidence: [expect.objectContaining({ id: "local-1" })],
          followUpQuestions: ["What next?"],
          createdAt: "2026-05-16T00:00:00.000Z",
        },
      },
    ]);
    expect(persisted).toEqual([expect.objectContaining({ question: "How?" })]);
  });
});

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function completedValue<T>(generator: AsyncGenerator<unknown, T>): Promise<T> {
  let step = await generator.next();
  while (!step.done) {
    step = await generator.next();
  }
  return step.value;
}

function decodedInvalidUtf8Fixture(): string {
  const encoded = readFileSync(
    join(__dirname, "..", "fixtures", "web", "russianfood-invalid-utf8.base64"),
    "utf8",
  ).trim();
  return new TextDecoder("utf-8").decode(Uint8Array.from(Buffer.from(encoded, "base64")));
}

function retrievalOf(ids: string[], path: string) {
  const source = markdownSource(path);
  return {
    chunks: ids.map((id, index) => retrieved(id, source, id, 1 - index * 0.1)),
    citations: ids.map((id) => citation(id, source)),
    usedFallback: false,
  };
}
