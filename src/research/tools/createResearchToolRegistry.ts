import { SearchProvider } from "../../shared/types";
import { NoteToolService } from "./NoteTools";
import { ResearchEvidenceRegistry } from "./ResearchEvidenceRegistry";
import { ResearchToolAvailability, ResearchToolRegistry } from "./ResearchToolRegistry";
import { ResearchRetriever } from "../types";
import { AttachmentSource } from "../../application/sources/AttachmentSource";
import { RagSource } from "../../application/sources/RagSource";
import { SourceManager } from "../../application/sources/DataSource";
import { WebSource } from "../../application/sources/WebSource";

export interface CreateResearchToolRegistryOptions {
  availability: ResearchToolAvailability;
  noteTools?: NoteToolService;
  retriever?: ResearchRetriever;
  searchProvider?: SearchProvider;
}

export interface CreatedResearchToolRegistry {
  evidence: ResearchEvidenceRegistry;
  tools: ResearchToolRegistry;
  /** Introspection view of the data sources that contributed tools. */
  sources: SourceManager;
}

export function createResearchToolRegistry(
  options: CreateResearchToolRegistryOptions,
): CreatedResearchToolRegistry {
  const evidence = new ResearchEvidenceRegistry();
  const availability: ResearchToolAvailability = {
    ...options.availability,
    retrieverAvailable: options.availability.retrieverAvailable && options.retriever !== undefined,
    webProviderAvailable:
      options.availability.webProviderAvailable && options.searchProvider !== undefined,
  };

  const sources = new SourceManager();

  if (options.noteTools) {
    // Lets create_note/update_note rewrite raw evidence-ID tokens into footnote links.
    options.noteTools.setCitationProvider(() => evidence.snapshot().citations);
    sources.register(
      new AttachmentSource({
        service: options.noteTools,
        availability: {
          noteAccess: availability.noteAccess,
          activeFileAccess: availability.activeFileAccess,
          noteMutationAccess: availability.noteMutationAccess,
        },
      }),
    );
  }

  if (
    options.retriever &&
    availability.retrieverAvailable &&
    (availability.searchMode === "indexOnly" || availability.searchMode === "indexAndWeb")
  ) {
    sources.register(new RagSource({ retriever: options.retriever, evidence }));
  }

  if (
    options.searchProvider &&
    availability.webProviderAvailable &&
    (availability.searchMode === "webOnly" || availability.searchMode === "indexAndWeb")
  ) {
    sources.register(new WebSource({ provider: options.searchProvider, evidence }));
  }

  return {
    evidence,
    tools: new ResearchToolRegistry(sources.tools(), availability),
    sources,
  };
}
