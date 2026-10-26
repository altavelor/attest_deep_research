import type {
  SubAgentDelegationGrant,
  SubAgentDelegator,
  SubAgentWaitOptions,
  SubAgentWaitResult,
} from "@application/ports/subAgent";
import {
  findOwnRun,
  type CreateSubAgentSessionInput,
  type ParentRunBinding,
  type ParentRunDeliveryContext,
  type RetrySubAgentCommand,
  type SubAgentCommand,
  type SubAgentResultState,
  type SubAgentRunReceipt,
  type SubAgentRunRef,
  type SubAgentSessionSummary,
} from "@core/research";
import { authorizeCall, ownedRecord } from "./authorization";
import type { SubAgentManagerParts } from "./managerParts";
import { resultStateOf } from "./resultState";
import { stopSessionWork } from "./scopeCleanup";
import type { SubAgentRunScheduler } from "./runScheduler";
import type { SubAgentSessionCreation } from "./sessionCreation";
import type { SubAgentSubmissions } from "./submissions";
import { sessionFailure } from "./SubAgentStateStore";
import { waitForRunResults } from "./waitForResults";

export interface SubAgentFacadeServices {
  parts: SubAgentManagerParts;
  creation: SubAgentSessionCreation;
  submissions: SubAgentSubmissions;
  scheduler: SubAgentRunScheduler;
  subscribe(listener: () => void): () => void;
}

/**
 * The model-facing facade of one parent run binding and delivery epoch. Every call
 * loads the chat's section, re-checks the binding and grant before touching state and
 * is delivered through the parent fences, so closing the parent rejects it at once.
 */
export class SubAgentDelegatorFacade implements SubAgentDelegator {
  constructor(
    private readonly services: SubAgentFacadeServices,
    private readonly binding: ParentRunBinding,
    private readonly delivery: ParentRunDeliveryContext,
  ) {}

  create(input: CreateSubAgentSessionInput): Promise<SubAgentSessionSummary> {
    return this.call(async (grant) => {
      const session = await this.services.creation.create(this.binding, grant, input);
      if (this.services.parts.context.getCurrentDeliveryEpoch() !== this.delivery.deliveryEpoch) {
        throw sessionFailure("fenced-delivery");
      }
      return session;
    });
  }

  getCreatedSession(createRequestId: string): Promise<SubAgentSessionSummary> {
    return this.call(() => this.services.creation.getCreatedSession(this.binding, createRequestId));
  }

  run(
    sessionId: string,
    command: Extract<SubAgentCommand, { type: "initial" }>,
    submissionId: string,
  ): Promise<SubAgentRunReceipt> {
    return this.submitCommand(sessionId, command, submissionId, true);
  }

  continue(
    sessionId: string,
    command: Exclude<SubAgentCommand, { type: "initial" }>,
    submissionId: string,
  ): Promise<SubAgentRunReceipt> {
    return this.submitCommand(sessionId, command, submissionId, false);
  }

  retry(
    sessionId: string,
    command: RetrySubAgentCommand,
    submissionId: string,
  ): Promise<SubAgentRunReceipt> {
    return this.call((grant) =>
      this.services.submissions.submit(
        this.binding,
        grant,
        sessionId,
        { kind: "retry", retry: command },
        submissionId,
      ),
    );
  }

  getResult(sessionId: string, runId: string): Promise<SubAgentResultState> {
    return this.call(() => {
      const state = this.read({ sessionId, runId });
      const { imports } = this.services.parts;
      if (state.state === "failed" && state.error.code === "import-failed") {
        imports.reconcile(sessionId, runId, this.delivery.deliveryEpoch);
      }
      if (state.state === "completed" || state.state === "failed") {
        imports.verify(sessionId, runId, this.delivery.deliveryEpoch);
      }
      return state;
    });
  }

  waitForResults(
    refs: readonly SubAgentRunRef[],
    options: SubAgentWaitOptions,
  ): Promise<SubAgentWaitResult> {
    return this.call((_grant, fence) => {
      refs.forEach((ref) => this.read(ref));
      return waitForRunResults(
        { subscribe: this.services.subscribe, read: (ref) => this.read(ref) },
        refs,
        options,
        fence,
      );
    });
  }

  stop(sessionId: string): Promise<void> {
    return this.call(async () => {
      const { parts, scheduler } = this.services;
      const record = ownedRecord(parts.store, this.binding, sessionId);
      const revision = stopSessionWork(scheduler, record, "stopped");
      await parts.store.flush(revision ?? parts.store.currentRevision);
      if (revision !== null) parts.notifyResults();
    });
  }

  private submitCommand(
    sessionId: string,
    command: SubAgentCommand,
    submissionId: string,
    initial: boolean,
  ): Promise<SubAgentRunReceipt> {
    return this.call((grant) => {
      if ((command?.type === "initial") !== initial) throw sessionFailure("invalid-input");
      return this.services.submissions.submit(
        this.binding,
        grant,
        sessionId,
        { kind: "command", command },
        submissionId,
      );
    });
  }

  private read(ref: SubAgentRunRef): SubAgentResultState {
    const record = ownedRecord(this.services.parts.store, this.binding, ref.sessionId);
    const run = findOwnRun(record, ref.runId);
    if (!run) throw sessionFailure("not-authorized");
    return resultStateOf(this.services.parts, record, run);
  }

  private call<T>(
    operation: (grant: SubAgentDelegationGrant, fence: AbortSignal) => T | Promise<T>,
  ): Promise<T> {
    const { parts } = this.services;
    return parts.fences.deliver(this.binding.parentRunId, async (fence) => {
      await parts.store.load();
      const grant = authorizeCall(
        parts.context,
        parts.fences,
        parts.store,
        this.binding,
        this.delivery,
      );
      return operation(grant, fence);
    });
  }
}
