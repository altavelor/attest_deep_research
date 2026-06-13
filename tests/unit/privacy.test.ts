import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { RetrievalResult } from "../../src/retrieval/RetrievalService";
import { ResearchService } from "../../src/research/ResearchService";
import {
  CHAT_PROVIDER_DESCRIPTION,
  DUCK_DUCK_GO_DESCRIPTION,
  EMBEDDING_PROVIDER_DESCRIPTION,
  INDEX_FOLDER_DESCRIPTION,
} from "../../src/settings/privacyCopy";
import {
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
  Citation,
  RetrievedChunk,
  SearchProvider,
  SearchProviderResult,
  SourceReference,
} from "../../src/shared/types";

describe("privacy boundaries", () => {
  it("does not log source content or generated answers from production code by default", () => {
    const allowedLogger = join(process.cwd(), "src/settings/debugLogger.ts");
    const files = sourceFiles(join(process.cwd(), "src")).filter((file) => file !== allowedLogger);
    const consoleCallPattern = /\bconsole\.(?:debug|info|log|warn|error)\s*\(/;
    const offenders = files.filter((file) => consoleCallPattern.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("sends only the typed question to web search, never retrieved vault content", async () => {
    const privateVaultText = "Private vault paragraph about Project Cardinal";
    const searchProvider = new RecordingSearchProvider();
    const service = new ResearchService({
      retriever: new FakeRetriever({
        chunks: [retrieved("local-1", markdownSource("Private/project.md"), privateVaultText)],
        citations: [citation("local-1", markdownSource("Private/project.md"))],
        usedFallback: false,
      }),
      searchProvider,
      chatModel: new FakeChatModel(),
      chatModelName: "qwen",
    });

    await collect(
      service.answer({ question: "What is the public background?", includeWebSearch: true }),
    );

    expect(searchProvider.queries).toEqual(["What is the public background?"]);
    expect(searchProvider.queries.join(" ")).not.toContain(privateVaultText);
    expect(searchProvider.queries.join(" ")).not.toContain("Private/project.md");
  });

  it("does not call DuckDuckGo when web search is not explicitly requested", async () => {
    const searchProvider = new RecordingSearchProvider();
    const service = new ResearchService({
      retriever: new FakeRetriever({
        chunks: [retrieved("local-1", markdownSource("Private/project.md"), "Private vault text")],
        citations: [citation("local-1", markdownSource("Private/project.md"))],
        usedFallback: false,
      }),
      searchProvider,
      chatModel: new FakeChatModel(),
      chatModelName: "qwen",
    });

    await collect(service.answer({ question: "What is in my vault?", includeWebSearch: false }));

    expect(searchProvider.queries).toEqual([]);
  });

  it("keeps settings copy explicit about local model calls and external DuckDuckGo calls", () => {
    expect(CHAT_PROVIDER_DESCRIPTION).toContain("Local");
    expect(CHAT_PROVIDER_DESCRIPTION).toContain("configured endpoint");
    expect(EMBEDDING_PROVIDER_DESCRIPTION).toContain("Local");
    expect(EMBEDDING_PROVIDER_DESCRIPTION).toContain("Vault chunks");
    expect(INDEX_FOLDER_DESCRIPTION).toContain("Vault-local");
    expect(DUCK_DUCK_GO_DESCRIPTION).toContain("External");
    expect(DUCK_DUCK_GO_DESCRIPTION).toContain("only the typed question");
    expect(DUCK_DUCK_GO_DESCRIPTION).toContain("never retrieved vault content");
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

class FakeRetriever {
  constructor(private readonly result: RetrievalResult) {}

  async search(): Promise<RetrievalResult> {
    return this.result;
  }
}

class RecordingSearchProvider implements SearchProvider {
  readonly queries: string[] = [];

  async search(query: string): Promise<SearchProviderResult[]> {
    this.queries.push(query);
    return [];
  }
}

class FakeChatModel implements ChatModelProvider {
  async listModels(): Promise<string[]> {
    return ["qwen"];
  }

  async *streamChat(_request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    yield { content: "Answer.", isComplete: false };
    yield { content: "", isComplete: true };
  }
}

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}
