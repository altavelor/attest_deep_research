import { RetrievalResult } from "../../src/retrieval/RetrievalService";
import { ResearchService } from "../../src/research/ResearchService";
import { buildResearchPrompt, extractFollowUpQuestions } from "../../src/research/prompts";
import {
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
  Citation,
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
  it("retrieves evidence, adds optional first-result web evidence, and streams the answer", async () => {
    const retriever = new FakeRetriever({
      chunks: [retrieved("local-1", markdownSource("Research/local.md"), "Local model notes")],
      citations: [citation("local-1", markdownSource("Research/local.md"), "Research/local.md")],
      usedFallback: false,
    });
    const webSearch = new FakeSearchProvider({
      source: webSource("https://example.com/local-models"),
      extractedText: "Web article text",
    });
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
    expect(webSearch.queries).toEqual(["How should I use local models?"]);
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

    expect(first.value).toEqual({ type: "delta", content: "First " });
    expect(persistFinalAnswer).not.toHaveBeenCalled();

    await iterator.next();
    const done = await iterator.next();

    expect(done.value).toEqual({
      type: "complete",
      answer: expect.objectContaining({ answer: "First second" }),
    });
    expect(persistFinalAnswer).toHaveBeenCalledTimes(1);
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
    options: { limit: number; includeWebResults: boolean };
  }> = [];

  constructor(private readonly result: RetrievalResult) {}

  async search(
    query: string,
    options: { limit: number; includeWebResults: boolean },
  ): Promise<RetrievalResult> {
    this.requests.push({ query, options });
    return this.result;
  }
}

class FakeSearchProvider implements SearchProvider {
  readonly queries: string[] = [];

  constructor(private readonly result: SearchProviderResult | null) {}

  async searchFirstResult(query: string): Promise<SearchProviderResult | null> {
    this.queries.push(query);
    return this.result;
  }
}

class FakeChatModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  constructor(private readonly chunks: ChatResponseChunk[]) {}

  async listModels(): Promise<string[]> {
    return ["qwen"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);

    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}
