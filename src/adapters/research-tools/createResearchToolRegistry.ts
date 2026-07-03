import { ToolManager } from "@application/tools/ToolManager";
import { ResearchEvidenceRegistry } from "./ResearchEvidenceRegistry";
import {
  ResearchToolAvailability,
  ResearchToolset,
  ResearchToolsetOptions,
} from "@application/research";
import { AttachmentSource } from "@application/sources";
import { NOTE_PERMISSIONS, createNoteTools } from "./note/createNoteTools";
import { RagSource } from "./index/RagSource";
import { SourceManager } from "@application/sources";
import { WebSource } from "./web/WebSource";
import { SubAgentSource } from "./sub-agent/SubAgentSource";
import { MapSourcesSource } from "./map-sources/MapSourcesSource";
import { DownloadSource } from "./download/DownloadSource";
import { DOWNLOAD_PERMISSIONS } from "./download/documentDownload";

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

  // Document download is a web capability that also writes to the vault: offered
  // only when web is active for this turn AND a vault writer is available.
  if (
    options.searchProvider?.fetchDocument &&
    options.vaultWriter &&
    availability.webProviderAvailable &&
    (availability.searchMode === "webOnly" || availability.searchMode === "indexAndWeb")
  ) {
    sources.register(
      new DownloadSource({
        provider: options.searchProvider,
        writer: options.vaultWriter,
        defaultFolder: options.downloadFolder ?? "",
      }),
    );
  }

  // The sub-agent is universal: offered whenever at least one read source is active
  // this turn (web, index, or notes) — never in a fully empty profile. It always
  // gets a read-only view of the current toolset (no mutation, no recursive
  // run_subagent) regardless of what the parent itself is permitted to do.
  const hasAnyReadSource =
    (options.searchProvider !== undefined && availability.webProviderAvailable) ||
    (options.retriever !== undefined && availability.retrieverAvailable) ||
    (options.noteTools !== undefined && availability.noteAccess);
  if (options.subAgentRunner && hasAnyReadSource) {
    sources.register(
      new SubAgentSource({
        runner: options.subAgentRunner,
        evidence,
        toolContext: {
          ...options,
          subAgentRunner: undefined,
          availability: { ...availability, noteMutationAccess: false },
        },
      }),
    );
  }

  // Map-reduce fan-out over documents (SPEC-corpus R5): needs both the sub-agent
  // runner and an active index retriever (it fans out one scoped sub-agent per
  // indexed document). MapSources re-scopes the context to a single source per run.
  if (
    options.subAgentRunner &&
    options.retriever &&
    availability.retrieverAvailable &&
    (availability.searchMode === "indexOnly" || availability.searchMode === "indexAndWeb")
  ) {
    sources.register(
      new MapSourcesSource({
        runner: options.subAgentRunner,
        retriever: options.retriever,
        evidence,
        toolContext: {
          ...options,
          subAgentRunner: undefined,
          availability: { ...availability, noteMutationAccess: false },
        },
      }),
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
  if (availability.noteMutationAccess) {
    granted.add(NOTE_PERMISSIONS.mutate);
    // Downloading writes into the vault; gate it behind the same mutation consent.
    granted.add(DOWNLOAD_PERMISSIONS.write);
  }
  return granted;
}
