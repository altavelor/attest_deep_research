import { SourceManager } from "@application/sources";
import { RagSource } from "@adapters/research-tools/index/RagSource";
import { ToolManager } from "@application/tools/ToolManager";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import type { ResearchRetriever } from "@application/contracts";
import type { RetrievalResult } from "@application/contracts";

const emptyResult: RetrievalResult = { chunks: [], citations: [], usedFallback: false };

const fakeRetriever: ResearchRetriever = {
  async search() {
    return emptyResult;
  },
};

describe("SourceManager", () => {
  it("exposes a descriptor for a registered RAG source", () => {
    const sources = new SourceManager();
    sources.register(new RagSource({ retriever: fakeRetriever, evidence: new ResearchEvidenceRegistry() }));

    const descriptors = sources.descriptors();
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({ id: "rag", kind: "rag", available: true });
    expect(sources.byKind("rag")).toHaveLength(1);
  });

  it("contributes the RAG source's tools into a ToolManager", () => {
    const sources = new SourceManager();
    sources.register(new RagSource({ retriever: fakeRetriever, evidence: new ResearchEvidenceRegistry() }));

    const manager = new ToolManager();
    sources.contributeTools(manager);

    const definitions = manager.definitions();
    expect(definitions.map((definition) => definition.function.name)).toContain("search_index");
    expect(definitions.map((definition) => definition.function.name)).toContain("list_index_urls");
    // The contributed tool is dispatchable by its registered name.
    expect(manager.has(definitions[0].function.name)).toBe(true);
  });

  it("omits tools from unavailable sources", () => {
    const sources = new SourceManager();
    sources.register(
      new RagSource({
        retriever: fakeRetriever,
        evidence: new ResearchEvidenceRegistry(),
        available: false,
      }),
    );
    expect(sources.tools()).toHaveLength(0);
  });
});
