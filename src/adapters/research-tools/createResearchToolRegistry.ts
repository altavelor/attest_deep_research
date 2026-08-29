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
import { AnswerArtifactRegistry } from "./media/AnswerArtifactRegistry";
import { MediaSource } from "./media/MediaSource";

export interface CreatedResearchToolRegistry extends ResearchToolset {
  evidence: ResearchEvidenceRegistry;
  artifacts: AnswerArtifactRegistry;
  tools: ToolManager;
  sources: SourceManager;
}

export function createResearchToolRegistry(
  options: ResearchToolsetOptions,
): CreatedResearchToolRegistry {
  const evidence = new ResearchEvidenceRegistry();
  const artifacts = new AnswerArtifactRegistry();
  const availability: ResearchToolAvailability = {
    ...options.availability,
    retrieverAvailable: options.availability.retrieverAvailable && options.retriever !== undefined,
    webProviderAvailable:
      options.availability.webProviderAvailable && options.searchProvider !== undefined,
  };

  const sources = new SourceManager();
  const permissions = grantedPermissions(availability);

  if (options.noteTools) {
    options.noteTools.setCitationProvider(() => evidence.snapshot().citations);
    sources.register(new AttachmentSource({ tools: createNoteTools(options.noteTools, evidence) }));
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
    sources.register(
      new WebSource({
        provider: options.searchProvider,
        evidence,
        artifacts,
        ...(options.web ? { web: options.web } : {}),
        ...(options.onWebSourceSelection
          ? { onSourceSelection: options.onWebSourceSelection }
          : {}),
      }),
    );
  }

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

  if (hasAnyReadSource) {
    sources.register(
      new MediaSource({
        artifacts,
        ...(options.imageSearch ? { imageSearch: options.imageSearch } : {}),
        ...(options.documentImageCandidates
          ? { documentCandidates: options.documentImageCandidates }
          : {}),
        readDocumentPaths: () => vaultEvidencePaths(evidence),
      }),
    );
  }

  const tools = new ToolManager([], permissions);
  sources.contributeTools(tools);

  return { evidence, artifacts, tools, sources };
}

/** Map the availability policy onto the opaque permission names tools check. */
function grantedPermissions(availability: ResearchToolAvailability): ReadonlySet<string> {
  const granted = new Set<string>();
  if (availability.noteAccess) granted.add(NOTE_PERMISSIONS.read);
  if (availability.activeFileAccess) granted.add(NOTE_PERMISSIONS.active);
  if (availability.noteMutationAccess) {
    granted.add(NOTE_PERMISSIONS.mutate);
    granted.add(DOWNLOAD_PERMISSIONS.write);
  }
  return granted;
}

/**
 * Vault documents the run already read or retrieved. Image discovery treats
 * their indexed images as eligible even when the query matches only the text.
 */
function vaultEvidencePaths(evidence: ResearchEvidenceRegistry): string[] {
  const paths: string[] = [];
  for (const chunk of evidence.snapshot().evidence) {
    const source = chunk.source as { path?: string };
    const path = typeof source.path === "string" ? source.path : "";
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}
