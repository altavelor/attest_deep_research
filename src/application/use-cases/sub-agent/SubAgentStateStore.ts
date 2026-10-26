import { isChatStorageError } from "@application/ports/chat";
import type { SubAgentSessionManagerContext } from "@application/ports/subAgent";
import {
  applySubAgentDelta,
  emptySubAgentState,
  subAgentSessionError,
  SubAgentSessionFailure,
  type SubAgentBufferedValue,
  type SubAgentCreateRecord,
  type SubAgentImportRecord,
  type SubAgentImportTombstone,
  type SubAgentModelSnapshot,
  type SubAgentObservationRecord,
  type SubAgentPendingAction,
  type SubAgentRecoveryMarker,
  type SubAgentSessionErrorCode,
  type SubAgentSessionRecord,
  type SubAgentStateEntity,
  type SubAgentStateSnapshot,
  type SubAgentSubmissionRecord,
  type ValidatedJsonValue,
} from "@core/research";

type StoreContext = Pick<SubAgentSessionManagerContext, "getChatId" | "repository" | "writer">;

/** Builds the failure thrown by a sub-agent facade for a session error code. */
export function sessionFailure(
  code: SubAgentSessionErrorCode,
  details?: Parameters<typeof subAgentSessionError>[1],
): SubAgentSessionFailure {
  return new SubAgentSessionFailure(subAgentSessionError(code, details));
}

/** Maps a storage or buffer failure to the persistence-failed session error with its storage code. */
export function persistenceFailure(error: unknown): SubAgentSessionFailure {
  if (error instanceof SubAgentSessionFailure) return error;
  const storageCode = isChatStorageError(error) ? error.code : "unknown";
  return sessionFailure("persistence-failed", { storageCode });
}

/**
 * Holds the manager's in-memory view of the chat's sub-agent section. The section is
 * loaded once for the chat bound on first use; every change is staged through the
 * durable writer first and then applied to the loaded view with the same delta semantics.
 */
export class SubAgentStateStore {
  private snapshot: SubAgentStateSnapshot | null = null;
  private loading: Promise<SubAgentStateSnapshot> | null = null;
  private revision = 0;

  constructor(private readonly context: StoreContext) {}

  get state(): SubAgentStateSnapshot | null {
    return this.snapshot;
  }

  get currentRevision(): number {
    return this.revision;
  }

  load(): Promise<SubAgentStateSnapshot> {
    if (this.snapshot) return Promise.resolve(this.snapshot);
    if (this.loading) return this.loading;
    const chatId = this.context.getChatId();
    if (chatId === null) return Promise.reject(sessionFailure("invalid-state"));
    this.loading = this.context.repository.load(chatId).then(
      (loaded) => {
        this.snapshot = loaded ?? emptySubAgentState(chatId);
        this.revision = Math.max(this.revision, this.snapshot.revision);
        return this.snapshot;
      },
      (error: unknown) => {
        this.loading = null;
        throw persistenceFailure(error);
      },
    );
    return this.loading;
  }

  record(sessionId: string): SubAgentSessionRecord | undefined {
    return this.snapshot?.records.find((entry) => entry.session.subAgentSessionId === sessionId);
  }

  create(createRequestId: string): SubAgentCreateRecord | undefined {
    return this.snapshot?.creates.find((entry) => entry.createRequestId === createRequestId);
  }

  submission(submissionId: string): SubAgentSubmissionRecord | undefined {
    return this.snapshot?.submissions.find((entry) => entry.submissionId === submissionId);
  }

  putRecord(next: SubAgentSessionRecord, previous?: SubAgentSessionRecord): number {
    let revision = this.put("session", next.session.subAgentSessionId, next.session);
    for (const run of next.runs) {
      if (previous?.runs.includes(run)) continue;
      revision = this.put("run", run.subAgentRunId, run);
    }
    return revision;
  }

  putCreate(create: SubAgentCreateRecord): number {
    return this.put("create", create.createRequestId, create);
  }

  putSubmission(submission: SubAgentSubmissionRecord): number {
    return this.put("submission", submission.submissionId, submission);
  }

  deleteSubmission(submissionId: string): number {
    return this.stage({ op: "delete", entity: "submission", id: submissionId });
  }

  putAction(action: SubAgentPendingAction): number {
    return this.put("action", action.actionKey, action);
  }

  putMarker(marker: SubAgentRecoveryMarker): number {
    return this.put("marker", marker.parentRunId, marker);
  }

  putObservation(entry: SubAgentObservationRecord): number {
    return this.put("observation", entry.observationId, entry);
  }

  putRunModel(runId: string, model: SubAgentModelSnapshot): number {
    return this.put("run", runId, { model });
  }

  putImport(entry: SubAgentImportRecord): number {
    return this.put("import", entry.importId, entry);
  }

  tombstoneImport(tombstone: SubAgentImportTombstone | null, reason = "stopped"): void {
    if (!tombstone) return;
    const entry = this.snapshot?.imports.find(
      (row) => row.runId === tombstone.runId && row.generation === tombstone.generation,
    );
    if (entry && entry.state !== "tombstoned") {
      this.put("import", entry.importId, { state: "tombstoned", tombstoneReason: reason });
    }
  }

  async flush(revision: number): Promise<void> {
    try {
      await this.context.writer.flushThrough(revision, "barrier");
    } catch (error) {
      throw persistenceFailure(error);
    }
  }

  private put(entity: SubAgentStateEntity, id: string, fields: object): number {
    return this.stage({
      op: "set",
      entity,
      id,
      fields: fields as unknown as Readonly<Record<string, ValidatedJsonValue>>,
    });
  }

  private stage(delta: SubAgentBufferedValue): number {
    const revision = this.revision + 1;
    let status: "accepted" | "full";
    try {
      status = this.context.writer.markDirty(`${delta.entity}:${delta.id}`, revision, delta);
    } catch (error) {
      throw persistenceFailure(error);
    }
    if (status === "full")
      throw sessionFailure("persistence-failed", { storageCode: "buffer-full" });
    this.revision = revision;
    if (this.snapshot) this.snapshot = applySubAgentDelta(this.snapshot, delta) ?? this.snapshot;
    return revision;
  }
}
