import { RetrievalResult } from "../../src/adapters/retrieval/RetrievalService";
import { SearchProvider, SearchProviderResult } from "../../src/application/ports/web";
import { ChatModelProvider, ChatRequest, ChatResponseChunk } from "../../src/core/agent/protocol";
import { LanguageInventoryItem } from "../../src/core/model/citation";

export class FakeRetriever {
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
  ) { }

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

export class FakeSearchProvider implements SearchProvider {
  readonly requests: Array<{ query: string; options: unknown }> = [];

  constructor(private readonly results: SearchProviderResult[] = []) { }

  async search(query: string, options: unknown): Promise<SearchProviderResult[]> {
    this.requests.push({ query, options });
    return this.results.filter((result) => result.query === query);
  }
}

export class RecordingSearchProvider implements SearchProvider {
  readonly queries: string[] = [];

  async search(query: string): Promise<SearchProviderResult[]> {
    this.queries.push(query);
    return [];
  }
}

export class FakeChatModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  constructor(
    private readonly chunks: ChatResponseChunk[] | ChatResponseChunk[][] = [
      { content: "Answer.", isComplete: false },
      { content: "", isComplete: true },
    ],
  ) { }

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
