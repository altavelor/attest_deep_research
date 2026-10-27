import type {
  SubAgentBatchStore,
  SubAgentDelegationGrant,
  SubAgentDelegator,
  SubAgentDurableWriter,
  SubAgentExecutionPort,
  SubAgentHost,
  SubAgentInspectionPort,
  SubAgentParentRun,
  SubAgentSessionManagerFactory,
} from "@application/ports/subAgent";
import type { MapSourcesRunContext } from "@application/ports/mapSources";
import {
  MapSourcesWorkerAdapter,
  type MapSourcesWorkerLimits,
} from "@application/use-cases/map-sources";
import { SubAgentParentCoordinator } from "@application/use-cases/sub-agent";
import type { ConversationSourceRegistry } from "@core/chat/sourceRegistry";
import {
  mapSourcesBatchError,
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
  logError(error: unknown): void;
  saveRegistry(): Promise<void>;
  onTimelineChanged(): void;
}

export interface ChatSubAgentParentRun {
  delegator: SubAgentDelegator;
  parent: SubAgentParentRun;
  mapSources?: MapSourcesRunContext;
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
  private readonly closingRuns = new Set<string>();
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
    const batches = this.host.batches?.();
    const coordinator = new SubAgentParentCoordinator({
      delegator,
      host: this.host,
      parentRunId: runId,
      ...(batches ? { pendingBatches: () => batches.pendingCount(runId) } : {}),
      logError: (error) => this.options.logError(error),
    });
    this.coordinators.set(runId, coordinator);
    return {
      ...(batches ? { mapSources: this.mapSourcesContext(binding, request, batches) } : {}),
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
    this.closingRuns.add(runId);
    this.coordinators.get(runId)?.dispose();
    this.coordinators.delete(runId);
    this.revokeGrants(runId);
    if (this.binding?.parentRunId === runId) {
      this.binding = null;
      this.execution = null;
      this.capacity = null;
    }
    await this.host
      .batches?.()
      .interrupt(
        runId,
        mapSourcesBatchError("parent-terminal", "The parent run ended before the batch finished."),
      )
      .catch((error: unknown) => this.options.logError(error));
    try {
      await this.host.closeAll(runId, reason);
    } catch (error) {
      this.options.logError(error);
    } finally {
      this.revokeGrants(runId);
      this.ownedRuns.delete(runId);
      this.closingRuns.delete(runId);
    }
  }

  private revokeGrants(runId: string): void {
    for (const grantId of [...this.grants.keys()]) {
      if (grantId === `grant-${runId}` || grantId.startsWith(`grant-${runId}-map-`)) {
        this.grants.delete(grantId);
      }
    }
  }

  inspection(): SubAgentInspectionPort | null {
    return this.bridge.inspection();
  }

  async dispose(): Promise<void> {
    for (const coordinator of this.coordinators.values()) coordinator.dispose();
    this.coordinators.clear();
    this.grants.clear();
    this.ownedRuns.clear();
    this.closingRuns.clear();
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
    const redact = this.options.services?.redact ?? ((text: string) => text);
    const { priorContext } = request;
    return execution.run({
      ...request,
      priorContext: {
        ...priorContext,
        priorEvidenceItems: this.evidence.priorEvidenceItems(priorContext.priorEvidence, redact),
      },
    });
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

  /**
   * Builds the map_sources context of a parent run: document workers run through grants
   * of origin map_sources with index-only search of the run's index scope, no active file,
   * notes or mutation, and the limits of the batch; batch notices go to the chat sink.
   */
  private mapSourcesContext(
    binding: ParentRunBinding,
    request: ChatRunRequest,
    batches: SubAgentBatchStore,
  ): MapSourcesRunContext {
    const deliveryEpoch = this.epoch;
    const delegator = (limits: MapSourcesWorkerLimits): SubAgentDelegator => {
      const grantId = `grant-${binding.parentRunId}-map-${limits.maxRounds}-${limits.maxResultChars}`;
      const { parentRunId } = binding;
      if (
        !this.grants.has(grantId) &&
        this.ownedRuns.has(parentRunId) &&
        !this.closingRuns.has(parentRunId)
      ) {
        this.grants.set(grantId, this.mapGrant(binding, request, limits));
      }
      return this.host!.delegatorFor(binding, { deliveryEpoch, grantId });
    };
    return {
      chatId: binding.chatSessionId,
      parentRunId: binding.parentRunId,
      workers: new MapSourcesWorkerAdapter({ delegator }),
      batches,
      notices: this.bridge,
      subscribe: (listener) => this.host?.subscribeResults(listener) ?? (() => undefined),
      now: this.options.now,
      redact: this.options.services?.redact ?? ((text) => text),
    };
  }

  private mapGrant(
    binding: ParentRunBinding,
    request: ChatRunRequest,
    limits: MapSourcesWorkerLimits,
  ): SubAgentDelegationGrant {
    const policy = this.sourcePolicy(request, false);
    const usesIndex = policy.indexScope !== "none";
    return {
      binding,
      callerMode: "thinking",
      budgetPolicy: { type: "local" },
      maximumSourcePolicy: {
        ...policy,
        searchMode: usesIndex ? "indexOnly" : "none",
        allowActiveFile: false,
        allowNoteMutation: false,
      },
      origin: "map_sources",
      limits: { ...limits, maxSearches: MAX_SUB_AGENT_SEARCHES },
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
