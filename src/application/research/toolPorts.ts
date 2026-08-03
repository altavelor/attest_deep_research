import type { SearchProvider } from "@application/ports/web";
import type { ImageSearchRegistry, ToolDocumentImageQuery } from "@application/ports/images";
import type { AnswerArtifact, ImageCandidate } from "@core/media";
import type { VaultWriter } from "@application/ports/vault";
import type { SubAgentPort } from "./subAgentPort";
import type { ChatModelProvider } from "@core/agent";
import type { ChatToolCall, ChatToolDefinition } from "@core/agent";
import type { Citation } from "@core/model";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import type { ResearchRetriever } from "@application/contracts/research";
import type { UrlStatusChecker } from "@application/contracts/research";
import type { AgentLoopOptions, AgentLoopEvent, AgentLoopResult } from "@core/agent";
import type { ToolManager } from "@application/tools/ToolManager";
import type { ResearchSearchMode } from "@application/contracts/research";

export interface ResearchToolAvailability {
  searchMode: ResearchSearchMode;
  noteAccess: boolean;
  activeFileAccess: boolean;
  retrieverAvailable: boolean;
  webProviderAvailable: boolean;
  noteMutationAccess: boolean;
}

export interface NoteToolAvailability {
  noteAccess: boolean;
  activeFileAccess: boolean;
  noteMutationAccess: boolean;
}

export interface NoteToolExecution {
  ok: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

export interface NoteToolService {
  setCitationProvider(provider: () => readonly Citation[]): void;
  definitions(): ChatToolDefinition[];
  mutationEnabled(): boolean;
  execute(toolCall: ChatToolCall): Promise<NoteToolExecution>;
}

export interface EvidenceSnapshotProvider {
  snapshot(): ResearchEvidenceSnapshot;
  resolveWebResult?(resultId: string): { canonicalUrl: string } | undefined;
}

export interface ResearchToolsetOptions {
  availability: ResearchToolAvailability;
  noteTools?: NoteToolService;
  retriever?: ResearchRetriever;
  urlStatusChecker?: UrlStatusChecker;
  indexSourcePaths?: readonly string[];
  searchProvider?: SearchProvider;

  subAgentRunner?: SubAgentPort;

  vaultWriter?: VaultWriter;

  downloadFolder?: string;

  imageSearch?: ImageSearchRegistry;

  documentImageCandidates?: (
    request: ToolDocumentImageQuery,
  ) => Promise<ImageCandidate[]> | ImageCandidate[];
}

export interface ArtifactSnapshotProvider {
  snapshot(): AnswerArtifact[] | undefined;
}

export interface ResearchToolset {
  evidence: EvidenceSnapshotProvider;
  artifacts: ArtifactSnapshotProvider;
  tools: ToolManager;
  sources: unknown;
}

export type ResearchToolsetFactory = (options: ResearchToolsetOptions) => ResearchToolset;

export type ToolLoopEvent = AgentLoopEvent;
export type ToolLoopResult = AgentLoopResult;
export interface ToolLoopRunnerOptions extends Omit<AgentLoopOptions, "modelRound" | "labeler"> {
  chatModel: ChatModelProvider;
  modelRound?: AgentLoopOptions["modelRound"];
}
export type ToolLoopRunner = (options: ToolLoopRunnerOptions) => Promise<ToolLoopResult>;
