import { readdirSync, readFileSync } from "fs";
import { createResearchToolRegistry } from "../../src/adapters/research-tools/createResearchToolRegistry";
import { runToolLoop } from "../../src/adapters/research-tools/ToolLoopRunner";
import { ChatCompletionsRoundAdapter } from "../../src/adapters/model-provider/chat/ChatCompletionsRoundAdapter";
import { join } from "path";

import { ResearchService } from "../../src/application/use-cases/ResearchService";
import {
  CHAT_PROVIDER_DESCRIPTION,
  DUCK_DUCK_GO_DESCRIPTION,
  EMBEDDING_PROVIDER_DESCRIPTION,
  INDEX_FOLDER_DESCRIPTION,
} from "../../src/adapters/settings/privacyCopy";
import { collectAsync } from "../helpers/async";
import { citation, markdownSource, retrieved } from "../helpers/factories";
import { FakeChatModel, FakeRetriever, RecordingSearchProvider } from "../helpers/researchFakes";

describe("privacy boundaries", () => {
  it("does not log source content or generated answers from production code by default", () => {
    const allowedLogger = join(process.cwd(), "src/adapters/settings/debugLogger.ts");
    const files = sourceFiles(join(process.cwd(), "src")).filter((file) => file !== allowedLogger);
    const consoleCallPattern = /\bconsole\.(?:debug|info|log|warn|error)\s*\(/;
    const offenders = files.filter((file) => consoleCallPattern.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

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

function sourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(path);
    }

    return entry.isFile() && path.endsWith(".ts") ? [path] : [];
  });
}
