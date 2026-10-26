import type {
  SubAgentCloseResult,
  SubAgentDelegator,
  SubAgentHost,
  SubAgentImportLookup,
  SubAgentInspectionPort,
  SubAgentSessionManagerContext,
  SubAgentSessionManagerFactory,
} from "@application/ports/subAgent";
import type { ParentRunBinding, ParentRunDeliveryContext, SubAgentRunRef } from "@core/research";
import { closeParentRun } from "./closeBarrier";
import { SubAgentImportCoordinator } from "./importCoordinator";
import type { SubAgentManagerParts } from "./managerParts";
import { SubAgentInspectionService } from "./SubAgentInspectionService";
import { SubAgentMainEvents } from "./mainEvents";
import { SubAgentObservationRecorder } from "./observationRecorder";
import { ParentFences } from "./parentFences";
import { SubAgentRunScheduler } from "./runScheduler";
import { SubAgentBudgetCoordinator } from "./subAgentBudget";
import { SubAgentSessionCreation } from "./sessionCreation";
import { SubAgentStateStore } from "./SubAgentStateStore";
import { SubAgentDelegatorFacade, type SubAgentFacadeServices } from "./SubAgentDelegatorFacade";
import { SubAgentSubmissions } from "./submissions";
import { SubAgentUserStop } from "./userStop";

/**
 * Owns the child sessions of one chat runtime: its own section view, queue, grants
 * checks and result listeners, with no registry shared between chats. The runtime is
 * its only lifecycle owner; model calls go through binding-scoped facades.
 */
export class SubAgentSessionManager implements SubAgentHost {
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly inspectionPort: SubAgentInspectionPort;
  private readonly userStop: SubAgentUserStop;
  private readonly parts: SubAgentManagerParts;
  private readonly services: SubAgentFacadeServices;
  private disposal: Promise<void> | null = null;

  constructor(context: SubAgentSessionManagerContext) {
    const store = new SubAgentStateStore(context);
    const fences = new ParentFences();
    const parts = {
      context,
      store,
      fences,
      budget: new SubAgentBudgetCoordinator({ context, store, fences }),
      sessionOptions: new Map(),
      outcomes: new Map(),
      unsavedImports: new Set(),
      notifyResults: () => this.notify(),
      notifyObservation: () => this.notifyChanges(),
    } as Partial<SubAgentManagerParts> as SubAgentManagerParts;
    parts.imports = new SubAgentImportCoordinator(parts, context.evidenceImport);
    parts.observation = new SubAgentObservationRecorder(parts);
    parts.mainEvents = new SubAgentMainEvents(parts);
    this.parts = parts;
    const scheduler = new SubAgentRunScheduler(this.parts);
    this.services = {
      parts: this.parts,
      scheduler,
      creation: new SubAgentSessionCreation(this.parts),
      submissions: new SubAgentSubmissions(this.parts, scheduler),
      subscribe: (listener) => this.subscribeResults(listener),
    };
    const userStop = new SubAgentUserStop(parts, scheduler);
    this.userStop = userStop;
    this.inspectionPort = new SubAgentInspectionService({
      load: () => parts.store.load(),
      inputs: () => ({
        state: parts.store.state,
        revision:
          parts.store.currentRevision +
          (parts.store.state?.records ?? []).reduce(
            (sum, record) => sum + parts.observation.liveRevision(record.session.subAgentSessionId),
            0,
          ),
        debug: context.isDebugCapture?.() === true,
        redact: (text) => parts.observation.redact(text),
        elapsed: (runId) => parts.observation.elapsed(runId),
        liveRevision: (sessionId) => parts.observation.liveRevision(sessionId),
        parentLive: (parentRunId) => !parts.fences.isRevoked(parentRunId),
      }),
      subscribe: (listener) => this.subscribeChanges(listener),
      stop: (sessionId, expectedRunId) => userStop.stop(sessionId, expectedRunId),
    });
  }

  inspection(): SubAgentInspectionPort {
    return this.inspectionPort;
  }

  /** Returns the manager's import lookup that the chat evidence bridge uses to check imports. */
  importLookup(): SubAgentImportLookup {
    return this.parts.imports;
  }

  delegatorFor(binding: ParentRunBinding, delivery: ParentRunDeliveryContext): SubAgentDelegator {
    return new SubAgentDelegatorFacade(this.services, { ...binding }, { ...delivery });
  }

  subscribeResults(listener: () => void): () => void {
    if (this.parts.fences.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  listRunRefs(parentRunId: string): readonly SubAgentRunRef[] {
    const state = this.parts.store.state;
    if (!state) return [];
    return state.records
      .filter(
        (record) =>
          record.session.parentRunId === parentRunId &&
          record.session.chatSessionId === state.chatId,
      )
      .flatMap((record) =>
        record.runs.map((run) => ({
          sessionId: record.session.subAgentSessionId,
          runId: run.subAgentRunId,
        })),
      );
  }

  private subscribeChanges(listener: () => void): () => void {
    if (this.parts.fences.disposed) return () => undefined;
    this.changeListeners.add(listener);
    return () => void this.changeListeners.delete(listener);
  }

  closeAll(parentRunId: string, terminalReason: string): Promise<SubAgentCloseResult> {
    this.parts.imports.forgetParent(parentRunId);
    return closeParentRun(this.parts, this.services.scheduler, parentRunId, terminalReason);
  }

  dispose(): Promise<void> {
    if (!this.disposal) {
      this.parts.fences.disposeAll();
      this.services.scheduler.fenceAll();
      this.listeners.clear();
      this.changeListeners.clear();
      this.parts.observation.clear();
      this.parts.mainEvents.clear();
      this.userStop.clear();
      this.parts.sessionOptions.clear();
      this.parts.outcomes.clear();
      this.parts.unsavedImports.clear();
      this.parts.imports.forgetParent(null);
      this.disposal = Promise.resolve();
    }
    return this.disposal;
  }

  private notify(): void {
    this.notifyChanges();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  }

  private notifyChanges(): void {
    for (const listener of [...this.changeListeners]) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  }
}

/** Creates the per-chat sub-agent session manager; the chat runtime calls it exactly once. */
export const createSubAgentSessionManager: SubAgentSessionManagerFactory = (context) =>
  new SubAgentSessionManager(context);
