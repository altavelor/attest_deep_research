import type {
  SubAgentDelegationGrant,
  SubAgentDelegator,
  SubAgentDurableWriter,
  SubAgentExecutionPort,
  SubAgentHost,
  SubAgentInspectionPort,
  SubAgentParentRun,
  SubAgentSessionManagerFactory,
} from "@application/ports/subAgent";
import { SubAgentParentCoordinator } from "@application/use-cases/sub-agent";
import type { ConversationSourceRegistry } from "@core/chat/sourceRegistry";
import {
  MAX_SUB_AGENT_SEARCHES,
  type ParentRunBinding,
  type ResearchMode,
  type SubAgentSourcePolicy,
} from "@core/research";
import { ChatSubAgentBridge } from "./ChatSubAgentBridge";
import { ChatSubAgentEvidenceBridge } from "./ChatSubAgentEvidenceBridge";
import type { ChatRunRequest, ChatSessionState, ChatSubAgentServices } from "./chatSessionTypes";

export interface ChatSubAgentsOptions {
  state: ChatSessionState;
  createManager?: SubAgentSessionManagerFactory;
  services?: ChatSubAgentServices;
  writer: SubAgentDurableWriter;
  now(): Date;
  createId(): string;
  saveRegistry(): Promise<void>;
  onTimelineChanged(): void;
}

export interface ChatSubAgentParentRun {
  delegator: SubAgentDelegator;
  parent: SubAgentParentRun;
}

const CHILD_MAX_ROUNDS = 12;
const CHILD_MAX_RESULT_CHARS = 30_000;

/**
 * Owns the sub-agent side of one chat runtime: the per-chat session manager created
 * once, the parent run binding, grant and delivery epoch of the current run, the relay
 * to that run's child execution, the evidence bridge and the main-transcript bridge.
 */
export class ChatSubAgents {
  private readonly host: SubAgentHost | null;
  private readonly bridge: ChatSubAgentBridge;
  private readonly evidence: ChatSubAgentEvidenceBridge;
  private readonly grants = new Map<string, SubAgentDelegationGrant>();
  private readonly ownedRuns = new Set<string>();
  private readonly coordinators = new Map<string, SubAgentParentCoordinator>();
  private binding: ParentRunBinding | null = null;
  private generation = 0;
  private epoch = 0;
  private execution: SubAgentExecutionPort | null = null;
  private capacity: { remainingWebCapacity?(): number } | null = null;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: ChatSubAgentsOptions) {
    const { state } = options;
    this.bridge = new ChatSubAgentBridge({
      state,
      ownsParentRun: (parentRunId) => this.ownedRuns.has(parentRunId),
      inspection: () => this.host?.inspection() ?? null,
      onTimelineChanged: options.onTimelineChanged,
    });
    this.evidence = new ChatSubAgentEvidenceBridge({
      lookup: () => this.host?.importLookup?.() ?? null,
      serialize: (work) => this.serialize(work),
      readRegistry: () => state.sourceRegistry,
      writeRegistry: (registry: ConversationSourceRegistry) => {
        state.sourceRegistry = registry;
      },
      saveRegistry: () => options.saveRegistry(),
    });
    this.host =
      options.createManager && options.services
        ? options.createManager({
            getChatId: () => state.chatId,
            repository: options.services.repository,
            writer: options.writer,
            execution: { run: (request) => this.runChild(request) },
            evidenceImport: this.evidence,
            getCurrentParentBinding: () => this.binding,
            getCurrentDeliveryEpoch: () => this.epoch,
            resolveGrant: (id) => this.grants.get(id) ?? null,
            now: options.now,
            createId: (prefix) => `${prefix}-${options.createId()}`,
            redact: options.services.redact,
            ...(options.services.monotonicNow
              ? { monotonicNow: options.services.monotonicNow }
              : {}),
            ...(options.services.isDebugCapture
              ? { isDebugCapture: options.services.isDebugCapture }
              : {}),
            mainEvents: this.bridge,
          })
        : null;
  }

  /**
   * Binds a Thinking parent run of a durable chat: a new binding generation, delivery
   * epoch and grant whose source policy and active file come from the run request.
   */
  beginParentRun(
    runId: string,
    request: ChatRunRequest,
    mode: ResearchMode,
  ): ChatSubAgentParentRun | null {
    const chatId = this.options.state.chatId;
    if (!this.host || mode !== "thinking" || chatId === null) return null;
    this.generation += 1;
    this.epoch += 1;
    const binding = {
      chatSessionId: chatId,
      parentRunId: runId,
      bindingGeneration: this.generation,
    };
    const grantId = `grant-${runId}`;
    this.binding = binding;
    this.ownedRuns.add(runId);
    this.grants.set(grantId, this.grant(binding, request));
    const delegator = this.host.delegatorFor(binding, { deliveryEpoch: this.epoch, grantId });
    const coordinator = new SubAgentParentCoordinator({
      delegator,
      host: this.host,
      parentRunId: runId,
    });
    this.coordinators.set(runId, coordinator);
    return {
      delegator,
      parent: {
        parentRunId: runId,
        coordinator,
        resolver: this.evidence,
        bindExecution: (execution) => {
          if (this.binding?.parentRunId === runId) this.execution = execution;
        },
        attachEvidence: (capacity) => {
          if (this.binding?.parentRunId === runId) this.capacity = capacity;
        },
      },
    };
  }

  /** Revokes and closes every child of a terminal parent run before its terminal save. */
  async closeParentRun(runId: string, reason: string): Promise<void> {
    if (!this.host || !this.ownedRuns.has(runId)) return;
    this.coordinators.get(runId)?.dispose();
    this.coordinators.delete(runId);
    this.grants.delete(`grant-${runId}`);
    if (this.binding?.parentRunId === runId) {
      this.binding = null;
      this.execution = null;
      this.capacity = null;
    }
    try {
      await this.host.closeAll(runId, reason);
    } catch {
      return;
    }
  }

  inspection(): SubAgentInspectionPort | null {
    return this.bridge.inspection();
  }

  async dispose(): Promise<void> {
    for (const coordinator of this.coordinators.values()) coordinator.dispose();
    this.coordinators.clear();
    this.grants.clear();
    this.binding = null;
    this.execution = null;
    this.bridge.dispose();
    await this.host?.dispose();
  }

  private runChild(
    request: Parameters<SubAgentExecutionPort["run"]>[0],
  ): ReturnType<SubAgentExecutionPort["run"]> {
    const execution = this.execution;
    if (!execution) return Promise.reject(new Error("No parent run can execute sub-agent work."));
    return execution.run(request);
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work, work);
    this.serial = result.catch(() => undefined);
    return result;
  }

  private grant(binding: ParentRunBinding, request: ChatRunRequest): SubAgentDelegationGrant {
    const allowActiveFile = request.includeActiveFile && request.activeFilePath !== undefined;
    return {
      binding,
      callerMode: "thinking",
      budgetPolicy: { type: "local" },
      maximumSourcePolicy: this.sourcePolicy(request, allowActiveFile),
      ...(allowActiveFile ? { capturedActiveFilePath: request.activeFilePath } : {}),
      origin: "direct",
      limits: {
        maxRounds: CHILD_MAX_ROUNDS,
        maxResultChars: CHILD_MAX_RESULT_CHARS,
        maxSearches: MAX_SUB_AGENT_SEARCHES,
      },
      remainingWebCapacity: () => this.capacity?.remainingWebCapacity?.() ?? 0,
    };
  }

  private sourcePolicy(request: ChatRunRequest, allowActiveFile: boolean): SubAgentSourcePolicy {
    const searchMode = this.options.state.chatSettings.searchMode;
    const usesIndex = searchMode === "indexOnly" || searchMode === "indexAndWeb";
    return {
      searchMode,
      contextPaths: [...request.contextPaths],
      indexScope: !usesIndex ? "none" : request.contextPaths.length > 0 ? "paths" : "all-allowed",
      allowActiveFile,
      allowNoteMutation: false,
    };
  }
}
