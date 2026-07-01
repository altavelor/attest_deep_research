import { ToolManager } from "../../application/tools/ToolManager";
import { ResearchEvidenceRegistry } from "./ResearchEvidenceRegistry";
import {
  ResearchToolAvailability,
  ResearchToolset,
  ResearchToolsetOptions,
} from "../../application/research/toolPorts";
import { AttachmentSource } from "@application/sources";
import { NOTE_PERMISSIONS, createNoteTools } from "./note/createNoteTools";
import { RagSource } from "./index/RagSource";
import { SourceManager } from "@application/sources";
import { WebSource } from "./web/WebSource";
import { DeepResearchSource } from "./deep-research/DeepResearchSource";

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
  const permissions = grantedPermissions(availability);

  if (options.noteTools) {
    // Lets create_note/update_note rewrite raw evidence-ID tokens into footnote links.
    options.noteTools.setCitationProvider(() => evidence.snapshot().citations);
    sources.register(new AttachmentSource({ tools: createNoteTools(options.noteTools) }));
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
  // source contributes its Tool handlers; the manager gates them by the run's
  // granted permissions (each tool's `requires`).
  const tools = new ToolManager([], permissions);
  sources.contributeTools(tools);

  return { evidence, tools, sources };
}

/** Map the availability policy onto the opaque permission names tools check. */
function grantedPermissions(availability: ResearchToolAvailability): ReadonlySet<string> {
  const granted = new Set<string>();
  if (availability.noteAccess) granted.add(NOTE_PERMISSIONS.read);
  if (availability.activeFileAccess) granted.add(NOTE_PERMISSIONS.active);
  if (availability.noteMutationAccess) granted.add(NOTE_PERMISSIONS.mutate);
  return granted;
}
