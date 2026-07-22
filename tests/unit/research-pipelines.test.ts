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
    expect(retriever.requests).toEqual([
      {
        query: "локальный research assistant",
        options: {
          limit: 4,
          includeWebResults: false,
          queryVariants: [
            {
              query: "local first research assistant",
              language: "en",
              reason: "translated",
            },
          ],
          sourcePaths: ["Notes/a.md"],
        },
      },
    ]);
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
      requests: [{ query: "public research", limit: 5, maxFetches: 3 }],
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
          reason: "duplicate-url",
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
});

describe("AnswerSynthesisService", () => {
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
    while (!(await stream.next()).done) {
      // Drain the completed answer after proving the deltas arrived live.
    }
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
