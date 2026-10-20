import { createResearchToolRegistry, runToolLoop } from "@adapters/research-tools";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";

import { ResearchService } from "@application/use-cases/research";
import {
  CHAT_PROVIDER_DESCRIPTION,
  EMBEDDING_PROVIDER_DESCRIPTION,
  INDEX_FOLDER_DESCRIPTION,
  WEB_SOURCES_DESCRIPTION,
} from "@adapters/settings";
import { collectAsync } from "../support/async";
import { citation, markdownSource, retrieved } from "../support/factories";
import { FakeChatModel, FakeRetriever, RecordingSearchProvider } from "../support/researchFakes";

describe("privacy boundaries", () => {
  it("sends only the typed question to web search, never retrieved vault content", async () => {
    const privateVaultText = "Private vault paragraph about Project Cardinal";
    const searchProvider = new RecordingSearchProvider();
    const service = new ResearchService({
      toolsetFactory: createResearchToolRegistry,
      runToolLoop,
      modelRoundFactory: (m) => new ChatCompletionsRoundAdapter(m),
      retriever: new FakeRetriever({
        chunks: [retrieved("local-1", markdownSource("Private/project.md"), privateVaultText)],
        citations: [citation("local-1", markdownSource("Private/project.md"))],
        usedFallback: false,
      }),
      searchProvider,
      chatModel: new FakeChatModel(),
      chatModelName: "qwen",
    });

    await collectAsync(
      service.answer({ question: "What is the public background?", includeWebSearch: true }),
    );

    expect(searchProvider.queries).toEqual(["What is the public background?"]);
    expect(searchProvider.queries.join(" ")).not.toContain(privateVaultText);
    expect(searchProvider.queries.join(" ")).not.toContain("Private/project.md");
  });

  it("does not call DuckDuckGo when web search is not explicitly requested", async () => {
    const searchProvider = new RecordingSearchProvider();
    const service = new ResearchService({
      toolsetFactory: createResearchToolRegistry,
      runToolLoop,
      modelRoundFactory: (m) => new ChatCompletionsRoundAdapter(m),
      retriever: new FakeRetriever({
        chunks: [retrieved("local-1", markdownSource("Private/project.md"), "Private vault text")],
        citations: [citation("local-1", markdownSource("Private/project.md"))],
        usedFallback: false,
      }),
      searchProvider,
      chatModel: new FakeChatModel(),
      chatModelName: "qwen",
    });

    await collectAsync(
      service.answer({ question: "What is in my vault?", includeWebSearch: false }),
    );

    expect(searchProvider.queries).toEqual([]);
  });

  it("keeps settings copy explicit about local model calls and external web calls", () => {
    expect(CHAT_PROVIDER_DESCRIPTION).toContain("Local");
    expect(CHAT_PROVIDER_DESCRIPTION).toContain("configured endpoint");
    expect(EMBEDDING_PROVIDER_DESCRIPTION).toContain("Local");
    expect(EMBEDDING_PROVIDER_DESCRIPTION).toContain("Vault chunks");
    expect(INDEX_FOLDER_DESCRIPTION).toContain("Vault-local");
    expect(WEB_SOURCES_DESCRIPTION).toContain("External");
    expect(WEB_SOURCES_DESCRIPTION).toContain("only the typed question");
    expect(WEB_SOURCES_DESCRIPTION).toContain("never retrieved vault content");
  });
});
