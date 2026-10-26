import type { ResearchRetriever, UrlStatusChecker } from "@application/contracts/research";
import type { SearchProvider } from "@application/ports/web";
import type { NoteToolService, ResearchToolsetOptions } from "@application/research/toolPorts";
import type { ResearchModeWebParameters, SubAgentSourcePolicy } from "@core/research";

export interface SubAgentToolSources {
  noteTools?: NoteToolService;
  retriever?: ResearchRetriever;
  searchProvider?: SearchProvider;
  urlStatusChecker?: UrlStatusChecker;
}

/**
 * Builds the read-only toolset options of one child run from its effective source
 * policy: no note mutation, no live active-note access, web only in a web search mode
 * and the index only when the policy grants an index scope.
 */
export function subAgentToolContext(
  sources: SubAgentToolSources,
  policy: SubAgentSourcePolicy,
  web: ResearchModeWebParameters,
): ResearchToolsetOptions {
  const usesWeb = policy.searchMode === "webOnly" || policy.searchMode === "indexAndWeb";
  const usesIndex = policy.indexScope !== "none";
  return {
    availability: {
      searchMode: policy.searchMode,
      noteAccess: sources.noteTools !== undefined,
      activeFileAccess: false,
      noteMutationAccess: false,
      retrieverAvailable: usesIndex && sources.retriever !== undefined,
      webProviderAvailable: usesWeb && sources.searchProvider !== undefined,
    },
    ...(sources.noteTools ? { noteTools: sources.noteTools } : {}),
    ...(usesIndex && sources.retriever ? { retriever: sources.retriever } : {}),
    ...(usesWeb && sources.searchProvider ? { searchProvider: sources.searchProvider } : {}),
    ...(sources.urlStatusChecker ? { urlStatusChecker: sources.urlStatusChecker } : {}),
    ...(policy.indexScope === "paths" ? { indexSourcePaths: policy.contextPaths } : {}),
    web,
  };
}
