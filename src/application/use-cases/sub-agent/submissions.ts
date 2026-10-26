import type { SubAgentDelegationGrant } from "@application/ports/subAgent";
import {
  applySubAgentTransition,
  isSubAgentStateId,
  SubAgentSessionFailure,
  type ParentRunBinding,
  type ResearchMode,
  type RetrySubAgentCommand,
  type SubAgentCommand,
  type SubAgentRunReceipt,
  type SubAgentTransition,
} from "@core/research";
import { ownedRecord } from "./authorization";
import { digestOf } from "./digest";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import type { SubAgentRunScheduler } from "./runScheduler";
import { sessionFailure } from "./SubAgentStateStore";

export type SubAgentSubmission =
  { kind: "command"; command: SubAgentCommand } | { kind: "retry"; retry: RetrySubAgentCommand };

/**
 * Accepts initial, follow-up, partial and retry commands under a host-derived
 * submission id. The command, its new queued run and the submission record are made
 * durable before the receipt is returned; a replay returns the same receipt and a
 * different command under the same id conflicts without creating a run.
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
    const digest = digestOf({ sessionId, submission });
    const existing = this.parts.store.submission(submissionId);
    if (existing) {
      if (existing.sessionId !== sessionId || existing.normalizedCommandDigest !== digest) {
        throw sessionFailure("idempotency-conflict");
      }
      ownedRecord(this.parts.store, binding, sessionId);
      return this.inFlight.get(submissionId) ?? Promise.resolve(existing.receipt);
    }
    const record = ownedRecord(this.parts.store, binding, sessionId);
    const runId = this.parts.context.createId("subagent-run");
    if (!isSubAgentStateId(runId)) throw sessionFailure("invalid-state");
    const at = timestamp(this.parts);
    const launch = { runId, at, callerMode: grant.callerMode as ResearchMode };
    const transition: SubAgentTransition =
      submission.kind === "retry"
        ? { type: "retry", retry: submission.retry, ...launch }
        : { type: "command", command: submission.command, origin: grant.origin, ...launch };
    const result = applySubAgentTransition(record, transition);
    if (!result.ok) throw new SubAgentSessionFailure(result.error);
    const { store } = this.parts;
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
    const accepted = this.accept(receipt, revision);
    this.inFlight.set(submissionId, accepted);
    const forget = (): void => void this.inFlight.delete(submissionId);
    accepted.then(forget, forget);
    return accepted;
  }

  private async accept(receipt: SubAgentRunReceipt, revision: number): Promise<SubAgentRunReceipt> {
    try {
      await this.parts.store.flush(revision);
    } catch (error) {
      this.rollback(receipt);
      throw error;
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
