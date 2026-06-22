import { createResearchToolRegistry } from "../../src/research/tools/createResearchToolRegistry";
import { ResearchRetriever } from "../../src/research/types";
import { SearchProvider } from "../../src/shared/types";

describe("createResearchToolRegistry", () => {
  it("creates only explicitly permitted tools and a fresh answer-scoped registry", () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const provider: SearchProvider = { search: vi.fn().mockResolvedValue([]) };
    const options = {
      retriever,
      searchProvider: provider,
      availability: {
        searchMode: "indexAndWeb" as const,
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
        retrieverAvailable: true,
        webProviderAvailable: true,
      },
    };

    const first = createResearchToolRegistry(options);
    const second = createResearchToolRegistry(options);

    expect(first.tools.definitions().map((definition) => definition.function.name)).toEqual([
      "search_index",
      "search_web",
    ]);
    expect(first.evidence).not.toBe(second.evidence);
    expect(first.tools.availability()).toEqual(options.availability);
  });

  it("does not expose or report index and web tools when dependencies are absent", () => {
    const created = createResearchToolRegistry({
      availability: {
        searchMode: "indexAndWeb",
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
        retrieverAvailable: true,
        webProviderAvailable: true,
      },
    });

    expect(created.tools.definitions()).toEqual([]);
    expect(created.tools.availability()).toMatchObject({
      retrieverAvailable: false,
      webProviderAvailable: false,
    });
  });
});
