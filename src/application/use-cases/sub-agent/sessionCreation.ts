import type { SubAgentDelegationGrant } from "@application/ports/subAgent";
import {
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
    const normalized = normalizeCreate(binding, grant, input);
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
    const joined = this.inFlight.get(existing.createRequestId);
    return (
      joined ??
      this.track(existing, this.publish(existing, normalized, this.parts.store.currentRevision))
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
    };
    store.putRecord({ session, runs: [] });
    const revision = store.putCreate({
      ...record,
      status: "published",
      publishedSessionId: session.subAgentSessionId,
    });
    this.parts.sessionOptions.set(session.subAgentSessionId, {
      grant: normalized.grant,
      resources: normalized.resources,
      maxSearches: normalized.maxSearches,
    });
    this.pendingInputs.delete(record.createRequestId);
    await store.flush(revision);
    return session;
  }
}

function normalizeCreate(
  binding: ParentRunBinding,
  grant: SubAgentDelegationGrant,
  input: CreateSubAgentSessionInput,
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
  const title = deriveSubAgentTitle(input.title);
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
    resources: resources.value,
    scopeReduction: policy.policy,
  });
  return {
    binding,
    grant,
    createRequestId: input.createRequestId,
    title,
    maxSearches,
    resources: resources.value,
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
