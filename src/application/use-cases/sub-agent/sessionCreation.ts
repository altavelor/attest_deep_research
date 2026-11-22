import type {
  SubAgentBudgetRegistration,
  SubAgentBudgetRegistrationResult,
  SubAgentDelegationGrant,
} from "@application/ports/subAgent";
import {
  applySubAgentTransition,
  deriveSubAgentTitle,
  isSubAgentStateId,
  readSubAgentSearchBudget,
  reduceSubAgentSourcePolicy,
  SubAgentSessionFailure,
  validateSubAgentResources,
  type CreateSubAgentSessionInput,
  type ParentRunBinding,
  type SubAgentCreateRecord,
  type SubAgentSessionErrorCode,
  type SubAgentSessionSummary,
  type SubAgentSourcePolicy,
} from "@core/research";
import { ownedRecord } from "./authorization";
import { digestOf } from "./digest";
import { timestamp, type SubAgentManagerParts } from "./managerParts";
import { scopeOf } from "./subAgentBudget";
import { sessionFailure } from "./SubAgentStateStore";

interface NormalizedCreate {
  binding: ParentRunBinding;
  grant: SubAgentDelegationGrant;
  createRequestId: string;
  title: string;
  maxSearches: number;
  resources: readonly string[];
  sourcePolicy: SubAgentSourcePolicy;
  digest: string;
}

const DENIAL_CODES: readonly SubAgentSessionErrorCode[] = [
  "budget-denied",
  "budget-port-error",
  "persistence-failed",
  "source-scope-denied",
];

/**
 * Creates sessions idempotently by host-derived create request id. A pending create
 * record with a stable candidate id is persisted before publication; a repeat with the
 * same normalized input joins or returns the same session and a different one conflicts.
 */
export class SubAgentSessionCreation {
  private readonly inFlight = new Map<string, Promise<SubAgentSessionSummary>>();
  private readonly pendingInputs = new Map<string, NormalizedCreate>();

  constructor(private readonly parts: SubAgentManagerParts) {}

  create(
    binding: ParentRunBinding,
    grant: SubAgentDelegationGrant,
    input: CreateSubAgentSessionInput,
  ): Promise<SubAgentSessionSummary> {
    const normalized = normalizeCreate(binding, grant, input, (text) =>
      this.parts.context.redact(text),
    );
    const existing = this.parts.store.create(normalized.createRequestId);
    if (existing) {
      this.assertOwner(binding, existing);
      if (existing.normalizedInputDigest !== normalized.digest) {
        throw sessionFailure("idempotency-conflict");
      }
      return this.resume(binding, existing, normalized);
    }
    const candidateSessionId = this.parts.context.createId("subagent-session");
    if (!isSubAgentStateId(candidateSessionId)) throw sessionFailure("invalid-state");
    const record: SubAgentCreateRecord = {
      createRequestId: normalized.createRequestId,
      normalizedInputDigest: normalized.digest,
      candidateSessionId,
      status: "pending",
      publishedSessionId: null,
      terminalReason: null,
    };
    const revision = this.parts.store.putCreate(record);
    this.pendingInputs.set(record.createRequestId, normalized);
    return this.track(record, this.publish(record, normalized, revision));
  }

  getCreatedSession(
    binding: ParentRunBinding,
    createRequestId: string,
  ): Promise<SubAgentSessionSummary> {
    const existing = this.parts.store.create(createRequestId);
    const pending = this.pendingInputs.get(createRequestId);
    if (!existing) throw sessionFailure("not-authorized");
    if (existing.status === "pending" && pending?.digest !== existing.normalizedInputDigest) {
      throw sessionFailure("not-authorized");
    }
    return this.resume(binding, existing, pending);
  }

  private assertOwner(binding: ParentRunBinding, existing: SubAgentCreateRecord): void {
    if (existing.status === "published" && existing.publishedSessionId !== null) {
      ownedRecord(this.parts.store, binding, existing.publishedSessionId);
    } else if (existing.status === "pending") {
      const pending = this.pendingInputs.get(existing.createRequestId);
      if (!pending || !sameParent(pending.binding, binding)) throw sessionFailure("not-authorized");
    }
  }

  private resume(
    binding: ParentRunBinding,
    existing: SubAgentCreateRecord,
    normalized: NormalizedCreate | undefined,
  ): Promise<SubAgentSessionSummary> {
    const joined = this.inFlight.get(existing.createRequestId);
    if (joined) return joined;
    if (existing.status === "published" && existing.publishedSessionId !== null) {
      return Promise.resolve(
        ownedRecord(this.parts.store, binding, existing.publishedSessionId).session,
      );
    }
    if (existing.status === "denied") {
      const code = DENIAL_CODES.find((entry) => entry === existing.terminalReason);
      throw sessionFailure(code ?? "invalid-state");
    }
    if (!normalized || !sameParent(normalized.binding, binding)) {
      throw sessionFailure("not-authorized");
    }
    return this.track(
      existing,
      this.publish(existing, normalized, this.parts.store.currentRevision),
    );
  }

  private track(
    record: SubAgentCreateRecord,
    publication: Promise<SubAgentSessionSummary>,
  ): Promise<SubAgentSessionSummary> {
    this.inFlight.set(record.createRequestId, publication);
    const forget = (): void => {
      if (this.inFlight.get(record.createRequestId) === publication) {
        this.inFlight.delete(record.createRequestId);
      }
    };
    publication.then(forget, forget);
    return publication;
  }

  private async publish(
    record: SubAgentCreateRecord,
    normalized: NormalizedCreate,
    pendingRevision: number,
  ): Promise<SubAgentSessionSummary> {
    const { store, fences } = this.parts;
    await store.flush(pendingRevision);
    if (fences.isRevoked(normalized.binding.parentRunId)) throw sessionFailure("fenced-delivery");
    const scopeId = scopeOf(normalized.grant.budgetPolicy);
    const registration = scopeId === null ? null : await this.register(record, normalized, scopeId);
    const at = timestamp(this.parts);
    const session: SubAgentSessionSummary = {
      subAgentSessionId: record.candidateSessionId,
      createRequestId: record.createRequestId,
      chatSessionId: normalized.binding.chatSessionId,
      parentRunId: normalized.binding.parentRunId,
      bindingGeneration: normalized.binding.bindingGeneration,
      status: "ready",
      title: normalized.title,
      sourcePolicy: normalized.sourcePolicy,
      budgetPolicy: normalized.grant.budgetPolicy,
      activeSubAgentRunId: null,
      pendingImportRunId: null,
      pendingImportGeneration: null,
      lastImportGeneration: 0,
      runCount: 0,
      revision: 0,
      contextSummary: null,
      evidenceRegistryId: `evidence:${record.candidateSessionId}`,
      createdAt: at,
      updatedAt: at,
      resources: normalized.resources,
      maxSearches: normalized.maxSearches,
      origin: normalized.grant.origin,
    };
    store.putRecord({ session, runs: [] });
    const revision = store.putCreate({
      ...record,
      status: "published",
      publishedSessionId: session.subAgentSessionId,
    });
    this.pendingInputs.delete(record.createRequestId);
    try {
      await store.flush(revision);
    } catch (error) {
      if (registration) {
        void this.abortRegistration(registration);
        await this.withdraw(record, session, "persistence-failed");
      }
      throw error;
    }
    if (registration) await this.finishRegistration(record, registration, session);
    this.parts.sessionOptions.set(session.subAgentSessionId, {
      grant: normalized.grant,
      resources: normalized.resources,
      maxSearches: normalized.maxSearches,
    });
    if (normalized.grant.origin === "direct") {
      this.parts.mainEvents.created(session.subAgentSessionId, "created");
    }
    return session;
  }

  /**
   * Registers the pending create with the scope owner off-lock and then re-checks the
   * create record and parent fence; a lost check aborts the registration so it finishes.
   */
  private async register(
    record: SubAgentCreateRecord,
    normalized: NormalizedCreate,
    scopeId: string,
  ): Promise<SubAgentBudgetRegistration> {
    let begun: SubAgentBudgetRegistrationResult;
    try {
      begun = await this.parts.budget.register(scopeId, record.createRequestId);
    } catch (error) {
      await this.deny(record, "budget-port-error");
      throw error;
    }
    if (begun.type === "denied") {
      await this.deny(record, "budget-denied");
      throw sessionFailure("budget-denied");
    }
    if (
      this.parts.fences.isRevoked(normalized.binding.parentRunId) ||
      this.parts.store.create(record.createRequestId)?.status !== "pending"
    ) {
      void this.abortRegistration(begun.registration);
      throw sessionFailure("fenced-delivery");
    }
    return begun.registration;
  }

  /** Finishes a published registration; a closed scope or port error archives the unusable session. */
  private async finishRegistration(
    create: SubAgentCreateRecord,
    registration: SubAgentBudgetRegistration,
    session: SubAgentSessionSummary,
  ): Promise<void> {
    let code: "budget-denied" | "budget-port-error" | null;
    try {
      const finished = await this.parts.budget.finishRegistration(registration, {
        type: "published",
        sessionId: session.subAgentSessionId,
      });
      code = finished.type === "accepted" ? null : "budget-denied";
    } catch {
      code = "budget-port-error";
    }
    if (code === null) return;
    await this.withdraw(create, session, code);
    throw sessionFailure(code);
  }

  /** Archives a published session that may not be used and stores the denial on its create record. */
  private async withdraw(
    create: SubAgentCreateRecord,
    session: SubAgentSessionSummary,
    terminalReason: SubAgentSessionErrorCode,
  ): Promise<void> {
    const record = this.parts.store.record(session.subAgentSessionId);
    try {
      const archived =
        record &&
        applySubAgentTransition(record, {
          type: "archive",
          reason: "user-archive",
          at: timestamp(this.parts),
        });
      if (record && archived?.ok) this.parts.store.putRecord(archived.record, record);
    } catch {
      return this.deny(create, terminalReason);
    }
    await this.deny(create, terminalReason);
  }

  private async abortRegistration(registration: SubAgentBudgetRegistration): Promise<void> {
    await this.parts.budget
      .finishRegistration(registration, { type: "aborted" })
      .catch(() => undefined);
  }

  private async deny(record: SubAgentCreateRecord, terminalReason: string): Promise<void> {
    this.pendingInputs.delete(record.createRequestId);
    try {
      await this.parts.store.flush(
        this.parts.store.putCreate({ ...record, status: "denied", terminalReason }),
      );
    } catch {
      return;
    }
  }
}

function normalizeCreate(
  binding: ParentRunBinding,
  grant: SubAgentDelegationGrant,
  input: CreateSubAgentSessionInput,
  redact: (text: string) => string,
): NormalizedCreate {
  const searches = readSubAgentSearchBudget(input.maxSearches);
  const resources = validateSubAgentResources(input.resources);
  if (
    !isSubAgentStateId(input.createRequestId) ||
    typeof input.title !== "string" ||
    !searches.ok ||
    !resources.ok
  ) {
    throw sessionFailure("invalid-input");
  }
  const policy = reduceSubAgentSourcePolicy(grant.maximumSourcePolicy, input.scopeReduction);
  if (!policy.ok) throw new SubAgentSessionFailure(policy.error);
  const title = deriveSubAgentTitle(redact(input.title));
  const safeResources = validateSubAgentResources(resources.value.map(redact));
  if (!safeResources.ok) throw sessionFailure("invalid-input");
  const maxSearches = Math.min(searches.value, grant.limits.maxSearches);
  const digest = digestOf({
    grant: {
      binding,
      callerMode: grant.callerMode,
      origin: grant.origin,
      budgetPolicy: grant.budgetPolicy,
      maximumSourcePolicy: grant.maximumSourcePolicy,
    },
    title,
    maxSearches,
    resources: safeResources.value,
    scopeReduction: policy.policy,
  });
  return {
    binding,
    grant,
    createRequestId: input.createRequestId,
    title,
    maxSearches,
    resources: safeResources.value,
    sourcePolicy: policy.policy,
    digest,
  };
}

function sameParent(left: ParentRunBinding, right: ParentRunBinding): boolean {
  return (
    left.chatSessionId === right.chatSessionId &&
    left.parentRunId === right.parentRunId &&
    left.bindingGeneration === right.bindingGeneration
  );
}
