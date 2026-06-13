import { RetrievalResult } from "../../src/retrieval/RetrievalService";
import { QueryExpansionService } from "../../src/retrieval/QueryExpansionService";
import { AnswerSynthesisService } from "../../src/research/AnswerSynthesisService";
import { VaultResearchPipeline } from "../../src/research/VaultResearchPipeline";
import { WebResearchPipeline } from "../../src/research/WebResearchPipeline";
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

    const events = await collect(pipeline.search("локальный research assistant", ["Notes/a.md"]));

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
  it("plans deep web queries from only the typed question", async () => {
    const searchProvider = new FakeSearchProvider([
      {
        source: webSource("https://example.com/research"),
        extractedText: "Public research article",
        rank: 1,
        query: "public research article",
      },
    ]);
    const chatModel = new FakeChatModel([
      [{ content: '{"queries":["public research article"]}', isComplete: true }],
    ]);
    const pipeline = new WebResearchPipeline({
      searchProvider,
      chatModel,
      chatModelName: "qwen",
      evidenceLimit: 4,
    });

    const events = await collect(pipeline.search("What is public research?", true, true));

    expect(events).toEqual([
      { type: "status", message: "Planning web queries..." },
      { type: "status", message: "Searching web..." },
      { type: "status", message: "Fetching sources..." },
    ]);
    expect(chatModel.requests[0].messages[1].content).toContain(
      "Question: What is public research?",
    );
    expect(searchProvider.requests).toEqual([
      { query: "public research article", options: { limit: 5, maxFetches: 5 } },
    ]);
  });
});

describe("AnswerSynthesisService", () => {
  it("streams deltas and completes with a persisted research answer", async () => {
    const persisted: unknown[] = [];
    const chatModel = new FakeChatModel([
      { content: "Answer [local-1].\n\n", isComplete: false },
      { content: "Follow-up questions:\n1. What next?", isComplete: true },
    ]);
    const service = new AnswerSynthesisService({
      chatModel,
      chatModelName: "qwen",
      temperature: 0.2,
      now: fixedNow,
      persistFinalAnswer: (answer) => {
        persisted.push(answer);
      },
    });
    const source = markdownSource("Research/local.md");
    const citations = [citation("local-1", source)];

    const events = await collect(
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

function citation(id: string, source: SourceReference): Citation {
  return { id, source, label: source.title };
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
