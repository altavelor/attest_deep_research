import type {
  SubAgentCloseResult,
  SubAgentDelegator,
  SubAgentHost,
  SubAgentSessionManagerContext,
  SubAgentSessionManagerFactory,
} from "@application/ports/subAgent";
import type { ParentRunBinding, ParentRunDeliveryContext, SubAgentRunRef } from "@core/research";
import { closeParentRun } from "./closeBarrier";
import type { SubAgentManagerParts } from "./managerParts";
import { ParentFences } from "./parentFences";
import { SubAgentRunScheduler } from "./runScheduler";
import { SubAgentSessionCreation } from "./sessionCreation";
import { SubAgentStateStore } from "./SubAgentStateStore";
import { SubAgentDelegatorFacade, type SubAgentFacadeServices } from "./SubAgentDelegatorFacade";
import { SubAgentSubmissions } from "./submissions";

/**
 * Owns the child sessions of one chat runtime: its own section view, queue, grants
 * checks and result listeners, with no registry shared between chats. The runtime is
 * its only lifecycle owner; model calls go through binding-scoped facades.
 */
export class SubAgentSessionManager implements SubAgentHost {
  private readonly listeners = new Set<() => void>();
  private readonly parts: SubAgentManagerParts;
  private readonly services: SubAgentFacadeServices;
  private disposal: Promise<void> | null = null;

  constructor(context: SubAgentSessionManagerContext) {
    this.parts = {
      context,
      store: new SubAgentStateStore(context),
      fences: new ParentFences(),
      sessionOptions: new Map(),
      outcomes: new Map(),
      unsavedImports: new Set(),
      notifyResults: () => this.notify(),
    };
    const scheduler = new SubAgentRunScheduler(this.parts);
    this.services = {
      parts: this.parts,
      scheduler,
      creation: new SubAgentSessionCreation(this.parts),
      submissions: new SubAgentSubmissions(this.parts, scheduler),
      subscribe: (listener) => this.subscribeResults(listener),
    };
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

  closeAll(parentRunId: string, terminalReason: string): Promise<SubAgentCloseResult> {
    return closeParentRun(this.parts, this.services.scheduler, parentRunId, terminalReason);
  }

  dispose(): Promise<void> {
    if (!this.disposal) {
      this.parts.fences.disposeAll();
      this.services.scheduler.fenceAll();
      this.listeners.clear();
      this.parts.sessionOptions.clear();
      this.parts.outcomes.clear();
      this.parts.unsavedImports.clear();
      this.disposal = Promise.resolve();
    }
    return this.disposal;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
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
