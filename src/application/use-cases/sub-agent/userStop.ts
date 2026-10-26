import type { SubAgentUserStopResult } from "@application/ports/subAgent";
import { controlRunIdOf } from "./inspectionView";
import type { SubAgentManagerParts } from "./managerParts";
import type { SubAgentRunScheduler } from "./runScheduler";
import { sessionFailure } from "./SubAgentStateStore";

/**
 * Archives one session of this chat for the user. The request must name the run the user
 * saw; the session is then fenced, its queue entry, run and import cancelled and the
 * archive staged in one synchronous step. A failed save keeps the fence and a repeated
 * request saves the same archive again.
 */
export class SubAgentUserStop {
  private readonly unsaved = new Map<string, string | null>();

  constructor(
    private readonly parts: SubAgentManagerParts,
    private readonly scheduler: SubAgentRunScheduler,
  ) {}

  clear(): void {
    this.unsaved.clear();
  }

  async stop(sessionId: string, expectedRunId: string | null): Promise<SubAgentUserStopResult> {
    const { parts } = this;
    if (parts.fences.disposed) throw sessionFailure("not-authorized");
    const state = await parts.store.load();
    const record = parts.store.record(sessionId);
    if (!record || record.session.chatSessionId !== state.chatId) {
      throw sessionFailure("not-authorized");
    }
    if (this.unsaved.has(sessionId)) return this.save(sessionId);
    const { session } = record;
    if (session.status === "archived" || parts.fences.isRevoked(session.parentRunId)) {
      return "already-terminal";
    }
    const controlRunId = controlRunIdOf(record);
    if (controlRunId !== expectedRunId) return "stale";
    this.scheduler.fenceSession(sessionId);
    parts.sessionOptions.delete(sessionId);
    const revision = this.scheduler.transition(sessionId, {
      type: "archive",
      reason: "user-archive",
    });
    if (revision === null) throw sessionFailure("invalid-state");
    this.unsaved.set(sessionId, session.activeSubAgentRunId ?? session.pendingImportRunId);
    return this.save(sessionId);
  }

  private async save(sessionId: string): Promise<"stopped"> {
    await this.parts.store.flush(this.parts.store.currentRevision);
    const stoppedRunId = this.unsaved.get(sessionId) ?? null;
    this.unsaved.delete(sessionId);
    if (stoppedRunId !== null) this.parts.mainEvents.terminal(sessionId, stoppedRunId, "stopped");
    this.parts.notifyResults();
    return "stopped";
  }
}
