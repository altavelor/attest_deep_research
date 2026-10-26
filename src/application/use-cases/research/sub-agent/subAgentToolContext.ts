import type { ResearchRetriever, UrlStatusChecker } from "@application/contracts/research";
import type { SearchProvider } from "@application/ports/web";
import type { NoteToolService, ResearchToolsetOptions } from "@application/research/toolPorts";
import type {
  ResearchModeWebParameters,
  SubAgentSourcePolicy,
  SubAgentTaskOrigin,
} from "@core/research";
import { pathScopedRetriever } from "./pathScopedRetriever";

export interface SubAgentToolSources {
  noteTools?: NoteToolService;
  retriever?: ResearchRetriever;
  searchProvider?: SearchProvider;
  urlStatusChecker?: UrlStatusChecker;
}

/**
 * Builds the read-only toolset options of one child run from its effective source
 * policy: no note mutation, no live active-note access, web only in a web search mode
 * and the index only when the policy grants an index scope. A path scope binds the
 * retriever itself to those paths, and a map_sources worker gets no note access.
 */
export function subAgentToolContext(
  sources: SubAgentToolSources,
  policy: SubAgentSourcePolicy,
  web: ResearchModeWebParameters,
  origin: SubAgentTaskOrigin = "direct",
): ResearchToolsetOptions {
  const usesWeb = policy.searchMode === "webOnly" || policy.searchMode === "indexAndWeb";
  const usesIndex = policy.indexScope !== "none";
  const notes = origin === "direct" ? sources.noteTools : undefined;
  const retriever =
    sources.retriever && policy.indexScope === "paths"
      ? pathScopedRetriever(sources.retriever, policy.contextPaths)
      : sources.retriever;
  return {
    availability: {
      searchMode: policy.searchMode,
      noteAccess: notes !== undefined,
      activeFileAccess: false,
      noteMutationAccess: false,
      retrieverAvailable: usesIndex && sources.retriever !== undefined,
      webProviderAvailable: usesWeb && sources.searchProvider !== undefined,
    },
    ...(notes ? { noteTools: notes } : {}),
    ...(usesIndex && retriever ? { retriever } : {}),
    ...(usesWeb && sources.searchProvider ? { searchProvider: sources.searchProvider } : {}),
    ...(sources.urlStatusChecker ? { urlStatusChecker: sources.urlStatusChecker } : {}),
    ...(policy.indexScope === "paths" ? { indexSourcePaths: policy.contextPaths } : {}),
    web,
  };
}
