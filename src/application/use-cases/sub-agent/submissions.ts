import type { SubAgentDelegationGrant } from "@application/ports/subAgent";
import {
  applySubAgentTransition,
  DEFAULT_SUB_AGENT_SEARCHES,
  isSubAgentStateId,
  subAgentSessionOrigin,
  SubAgentSessionFailure,
  type ParentRunBinding,
  type ResearchMode,
  type RetrySubAgentCommand,
  type SubAgentCommand,
  type SubAgentRunReceipt,
  type SubAgentSessionSummary,
  type SubAgentTransition,
} from "@core/research";
import { assertSessionBudget, ownedRecord } from "./authorization";
import { digestOf } from "./digest";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import { LOCAL_RUN_CAPACITY, type SubAgentRunScheduler } from "./runScheduler";
import { sessionFailure } from "./SubAgentStateStore";
import { publishedRecord } from "./unsavedImports";

export type SubAgentSubmission =
  { kind: "command"; command: SubAgentCommand } | { kind: "retry"; retry: RetrySubAgentCommand };

/**
 * Accepts initial, follow-up, partial and retry commands under a host-derived
 * submission id. The command, its new queued run and the submission record are made
 * durable before the receipt is returned; a replay returns the same receipt and a
 * different command under the same id conflicts without creating a run. A session whose
 * import write is still unsaved is importing and refuses new work.
 */
export class SubAgentSubmissions {
  private readonly inFlight = new Map<string, Promise<SubAgentRunReceipt>>();

  constructor(
    private readonly parts: SubAgentManagerParts,
    private readonly scheduler: SubAgentRunScheduler,
  ) {}

  submit(
    binding: ParentRunBinding,
    grant: SubAgentDelegationGrant,
    sessionId: string,
    submission: SubAgentSubmission,
    submissionId: string,
  ): Promise<SubAgentRunReceipt> {
    if (!isSubAgentStateId(submissionId)) throw sessionFailure("invalid-input");
    const digest = digestOf({ sessionId, submission, parentRunId: binding.parentRunId });
    const record = ownedRecord(this.parts.store, binding, sessionId);
    assertSessionBudget(record, grant);
    const origin = subAgentSessionOrigin(record);
    if (origin !== undefined && origin !== grant.origin) throw sessionFailure("not-authorized");
    const existing = this.parts.store.submission(submissionId);
    if (existing) {
      ownedRecord(this.parts.store, binding, existing.sessionId);
      if (existing.sessionId !== sessionId || existing.normalizedCommandDigest !== digest) {
        throw sessionFailure("idempotency-conflict");
      }
      return this.inFlight.get(submissionId) ?? Promise.resolve(existing.receipt);
    }
    if (publishedRecord(this.parts, record) !== record) throw sessionFailure("invalid-state");
    const runId = this.parts.context.createId("subagent-run");
    if (!isSubAgentStateId(runId)) throw sessionFailure("invalid-state");
    const at = timestamp(this.parts);
    const launch = {
      runId,
      at,
      callerMode: grant.callerMode as ResearchMode,
      owner: { parentRunId: binding.parentRunId, bindingGeneration: binding.bindingGeneration },
      grantMaximum: grant.maximumSourcePolicy,
    };
    const transition: SubAgentTransition =
      submission.kind === "retry"
        ? { type: "retry", retry: submission.retry, ...launch }
        : {
            type: "command",
            command: {
              ...submission.command,
              task: this.parts.context.redact(submission.command.task),
            },
            origin: grant.origin,
            ...launch,
          };
    const result = applySubAgentTransition(record, transition);
    if (!result.ok) throw new SubAgentSessionFailure(result.error);
    const { store } = this.parts;
    this.rebindOptions(record.session, grant);
    store.putRecord(result.record, record);
    store.tombstoneImport(result.tombstonedImport);
    const receipt: SubAgentRunReceipt = { sessionId, runId, submissionId, acceptedAt: at };
    const revision = store.putSubmission({
      submissionId,
      sessionId,
      normalizedCommandDigest: digest,
      runId,
      receipt,
    });
    const kind = submission.kind === "retry" ? "retry" : submission.command.type;
    const accepted = this.accept(receipt, revision, kind);
    this.inFlight.set(submissionId, accepted);
    const forget = (): void => void this.inFlight.delete(submissionId);
    accepted.then(forget, forget);
    return accepted;
  }

  private rebindOptions(session: SubAgentSessionSummary, grant: SubAgentDelegationGrant): void {
    const previous = this.parts.sessionOptions.get(session.subAgentSessionId);
    const maxSearches = session.maxSearches ?? previous?.maxSearches ?? DEFAULT_SUB_AGENT_SEARCHES;
    this.parts.sessionOptions.set(session.subAgentSessionId, {
      grant,
      resources: session.resources ?? previous?.resources ?? [],
      maxSearches: Math.min(maxSearches, grant.limits.maxSearches),
    });
  }

  private async accept(
    receipt: SubAgentRunReceipt,
    revision: number,
    kind: SubAgentCommand["type"] | "retry",
  ): Promise<SubAgentRunReceipt> {
    try {
      await this.parts.store.flush(revision);
    } catch (error) {
      this.rollback(receipt);
      throw error;
    }
    const { mainEvents } = this.parts;
    mainEvents.dispatch(receipt.sessionId, receipt.runId, kind);
    if (this.scheduler.runningCount >= LOCAL_RUN_CAPACITY) {
      mainEvents.created(receipt.sessionId, "queued", receipt.runId);
    }
    this.scheduler.enqueue({ sessionId: receipt.sessionId, runId: receipt.runId });
    return receipt;
  }

  private rollback(receipt: SubAgentRunReceipt): void {
    try {
      this.scheduler.transition(receipt.sessionId, {
        type: "execution-denied",
        runId: receipt.runId,
        reason: "acceptance-failed",
      });
      this.parts.store.deleteSubmission(receipt.submissionId);
    } catch {
      return;
    }
  }
}
