// Ports for the research tooling (stage 6, task "tools -> adapters"). The
// application use-cases depend on these neutral abstractions; concrete
// implementations (note tools, evidence registry, web/index tools, the tool
// loop runner) live in adapters/research-tools and are wired by the composition
// root. This keeps application/use-cases free of any adapters import.

import type { SearchProvider } from "@application/ports/web";
import type { VaultWriter } from "@application/ports/vault";
import type { SubAgentPort } from "./subAgentPort";
import type { ChatModelProvider } from "@core/agent";
import type { ChatToolCall, ChatToolDefinition } from "@core/agent";
import type { Citation } from "@core/model";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import type { ResearchRetriever } from "@application/contracts/research";
import type { UrlStatusChecker } from "@application/contracts/research";
import type {
  AgentLoopOptions,
  AgentLoopEvent,
  AgentLoopResult,
} from "@core/agent";
import type { ToolManager } from "@application/tools/ToolManager";
import type { ResearchSearchMode } from "@application/contracts/research";

/** Which research tools are exposed for a run (gating policy). */
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

/** Result of a single note-tool invocation (neutral DTO). */
export interface NoteToolExecution {
  ok: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

/** What the application needs from the note-tool service (concrete impl in adapters). */
export interface NoteToolService {
  setCitationProvider(provider: () => readonly Citation[]): void;
  definitions(): ChatToolDefinition[];
  mutationEnabled(): boolean;
  execute(toolCall: ChatToolCall): Promise<NoteToolExecution>;
}

export interface EvidenceSnapshotProvider {
  snapshot(): ResearchEvidenceSnapshot;
}

/** Options the toolset factory accepts (built by the composition root). */
export interface ResearchToolsetOptions {
  availability: ResearchToolAvailability;
  noteTools?: NoteToolService;
  retriever?: ResearchRetriever;
  urlStatusChecker?: UrlStatusChecker;
  indexSourcePaths?: readonly string[];
  searchProvider?: SearchProvider;
  /** Enables the `run_subagent` tool when present (and at least one read source is active). */
  subAgentRunner?: SubAgentPort;
  /** Enables document download tools (writes downloaded files into the vault). */
  vaultWriter?: VaultWriter;
  /** Default vault folder for downloaded documents when the agent gives no explicit path. */
  downloadFolder?: string;
}

/** Assembled research toolset (concrete factory lives in adapters). */
export interface ResearchToolset {
  evidence: EvidenceSnapshotProvider;
  tools: ToolManager;
  sources: unknown;
}

export type ResearchToolsetFactory = (options: ResearchToolsetOptions) => ResearchToolset;

/** Tool-loop runner port (the chat-completions-backed impl lives in adapters). */
export type ToolLoopEvent = AgentLoopEvent;
export type ToolLoopResult = AgentLoopResult;
export interface ToolLoopRunnerOptions extends Omit<AgentLoopOptions, "modelRound" | "labeler"> {
  chatModel: ChatModelProvider;
  modelRound?: AgentLoopOptions["modelRound"];
}
export type ToolLoopRunner = (options: ToolLoopRunnerOptions) => Promise<ToolLoopResult>;
