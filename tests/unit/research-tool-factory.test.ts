import { createResearchToolRegistry } from "@adapters/research-tools";
import { ResearchRetriever } from "@application/contracts";
import { SearchProvider } from "@application/ports";

describe("createResearchToolRegistry", () => {
  it("creates only explicitly permitted tools and a fresh answer-scoped registry", () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const provider: SearchProvider = { search: vi.fn().mockResolvedValue([]) };
    const urlStatusChecker = { checkUrls: vi.fn().mockResolvedValue([]) };
    const options = {
      retriever,
      searchProvider: provider,
      urlStatusChecker,
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
      "list_index_sources",
      "list_index_chunks",
      "read_index_chunk",
      "read_index_section",
      "find_in_index",
      "summarize_index_source",
      "get_index_source_outline",
      "search_index_by_metadata",
      "get_source_metadata",
      "get_source_summary",
      "list_shared_references",
      "find_claims",
      "list_index_urls",
      "check_urls",
      "search_web",
    ]);
    expect(first.evidence).not.toBe(second.evidence);
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
  });

  it("exposes URL inventory tools in index-only mode when index dependencies exist", () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
      listIndexedUrls: vi.fn().mockResolvedValue({ items: [] }),
    };
    const urlStatusChecker = { checkUrls: vi.fn().mockResolvedValue([]) };

    const created = createResearchToolRegistry({
      retriever,
      urlStatusChecker,
      availability: {
        searchMode: "indexOnly",
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
        retrieverAvailable: true,
        webProviderAvailable: false,
      },
    });

    expect(created.tools.definitions().map((definition) => definition.function.name)).toEqual([
      "search_index",
      "list_index_sources",
      "list_index_chunks",
      "read_index_chunk",
      "read_index_section",
      "find_in_index",
      "summarize_index_source",
      "get_index_source_outline",
      "search_index_by_metadata",
      "get_source_metadata",
      "get_source_summary",
      "list_shared_references",
      "find_claims",
      "list_index_urls",
      "check_urls",
    ]);
  });

  it("exposes map_sources (and run_subagent) only when a sub-agent runner and index are present", () => {
    const retriever: ResearchRetriever = {
      search: vi.fn().mockResolvedValue({ chunks: [], citations: [], usedFallback: false }),
    };
    const subAgentRunner = { run: vi.fn() };

    const indexed = createResearchToolRegistry({
      retriever,
      subAgentRunner,
      availability: {
        searchMode: "indexOnly",
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
        retrieverAvailable: true,
        webProviderAvailable: false,
      },
    });
    const indexedNames = indexed.tools.definitions().map((definition) => definition.function.name);
    expect(indexedNames).toContain("run_subagent");
    expect(indexedNames).toContain("map_sources");

    // Web-only: run_subagent is available, but map_sources needs an index.
    const webOnly = createResearchToolRegistry({
      searchProvider: { search: vi.fn().mockResolvedValue([]) },
      subAgentRunner,
      availability: {
        searchMode: "webOnly",
        noteAccess: false,
        activeFileAccess: false,
        noteMutationAccess: false,
        retrieverAvailable: false,
        webProviderAvailable: true,
      },
    });
    const webNames = webOnly.tools.definitions().map((definition) => definition.function.name);
    expect(webNames).toContain("run_subagent");
    expect(webNames).not.toContain("map_sources");
  });
});
