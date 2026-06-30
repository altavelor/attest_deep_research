import { ToolManager } from "../../core/agent/tool";
import { ResearchEvidenceRegistry } from "./ResearchEvidenceRegistry";
import {
  ResearchToolAvailability,
  ResearchToolset,
  ResearchToolsetOptions,
} from "../../application/research/toolPorts";
import { AttachmentSource } from "../../application/sources/AttachmentSource";
import { RagSource } from "../../application/sources/RagSource";
import { SourceManager } from "../../application/sources/DataSource";
import { WebSource } from "../../application/sources/WebSource";
import { DeepResearchSource } from "../../application/sources/DeepResearchSource";

export interface CreatedResearchToolRegistry extends ResearchToolset {
  evidence: ResearchEvidenceRegistry;
  tools: ToolManager;
  /** Introspection view of the data sources that contributed tools. */
  sources: SourceManager;
}

export function createResearchToolRegistry(
  options: ResearchToolsetOptions,
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
    sources.register(
      new RagSource({
        retriever: options.retriever,
        urlStatusChecker: options.urlStatusChecker,
        indexSourcePaths: options.indexSourcePaths,
        evidence,
      }),
    );
  }

  if (
    options.searchProvider &&
    availability.webProviderAvailable &&
    (availability.searchMode === "webOnly" || availability.searchMode === "indexAndWeb")
  ) {
    sources.register(new WebSource({ provider: options.searchProvider, evidence }));
  }

  // Deep research is a web capability — only offered when web is active for this
  // turn (same gating as WebSource), never in index-only / none modes.
  if (
    options.deepResearchRunner &&
    options.searchProvider &&
    availability.webProviderAvailable &&
    (availability.searchMode === "webOnly" || availability.searchMode === "indexAndWeb")
  ) {
    sources.register(
      new DeepResearchSource({ runner: options.deepResearchRunner, evidence }),
    );
  }

  // SourceManager -> ToolManager bridge (SPEC R5 diagram): each registered
  // source contributes its Tool handlers into the manager the agent loop queries.
  const tools = new ToolManager();
  sources.contributeTools(tools);

  return { evidence, tools, sources };
}
