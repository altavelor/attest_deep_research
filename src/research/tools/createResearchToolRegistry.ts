import { SearchProvider } from "../../shared/types";
import { IndexResearchTool } from "./IndexResearchTool";
import { NoteToolService } from "./NoteTools";
import { ResearchEvidenceRegistry } from "./ResearchEvidenceRegistry";
import {
  adaptNoteToolHandlers,
  ResearchToolAvailability,
  ResearchToolRegistry,
} from "./ResearchToolRegistry";
import { ResearchToolHandler } from "./ResearchTools";
import { ResearchRetriever } from "../types";
import { WebFetchResearchTool } from "./WebFetchResearchTool";
import { WebSearchResearchTool } from "./WebSearchResearchTool";

export interface CreateResearchToolRegistryOptions {
  availability: ResearchToolAvailability;
  noteTools?: NoteToolService;
  retriever?: ResearchRetriever;
  searchProvider?: SearchProvider;
}

export interface CreatedResearchToolRegistry {
  evidence: ResearchEvidenceRegistry;
  tools: ResearchToolRegistry;
}

export function createResearchToolRegistry(
  options: CreateResearchToolRegistryOptions,
): CreatedResearchToolRegistry {
  const evidence = new ResearchEvidenceRegistry();
  const handlers: ResearchToolHandler<any, any>[] = [];
  const availability: ResearchToolAvailability = {
    ...options.availability,
    retrieverAvailable: options.availability.retrieverAvailable && options.retriever !== undefined,
    webProviderAvailable:
      options.availability.webProviderAvailable && options.searchProvider !== undefined,
  };

  if (options.noteTools) {
    handlers.push(
      ...adaptNoteToolHandlers(options.noteTools, {
        noteAccess: availability.noteAccess,
        activeFileAccess: availability.activeFileAccess,
        skillAccess: availability.skillAccess,
      }, evidence),
    );
  }

  if (
    options.retriever &&
    availability.retrieverAvailable &&
    (availability.searchMode === "indexOnly" || availability.searchMode === "indexAndWeb")
  ) {
    handlers.push(new IndexResearchTool({ retriever: options.retriever, evidence }));
  }

  if (
    options.searchProvider &&
    availability.webProviderAvailable &&
    (availability.searchMode === "webOnly" || availability.searchMode === "indexAndWeb")
  ) {
    handlers.push(new WebSearchResearchTool({ provider: options.searchProvider, evidence }));
    if (options.searchProvider.fetchPage) {
      handlers.push(new WebFetchResearchTool({ provider: options.searchProvider, evidence }));
    }
  }

  return {
    evidence,
    tools: new ResearchToolRegistry(handlers, availability),
  };
}
