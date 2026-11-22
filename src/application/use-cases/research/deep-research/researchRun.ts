import type { RetrievedChunk } from "@core/model";
import {
  ResearchBudgetOwner,
  boundedReason,
  openWorks,
  reportDecision,
  resumeExecutions,
  stopReasonOf,
  verificationCounts,
  waveSize,
  type BranchExecution,
  type ResearchPlan,
  type ResearchReport,
  type ResearchState,
  type VerificationSummary,
} from "@core/research/deepResearch";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { BranchRunner } from "./branchRunner";
import type { ReportSynthesisService } from "./ReportSynthesisService";
import type { EvidenceVerificationOptions } from "./EvidenceVerificationService";
import { ResearchBudgetPermits } from "./ResearchBudgetPermits";
import type { AttachedResearchBudget } from "./ResearchScopeRouter";
import type { ResearchSchedulerRunners } from "./ResearchScheduler";
import { runSchedulingPhase } from "./researchScheduling";
import { runVerificationPhase } from "./researchVerificationPhase";
import { withMissingNote, writeReportMarkdown } from "./researchReportWriting";

export type ResearchVerifierOptions = Pick<
  EvidenceVerificationOptions,
  "resolveEvidence" | "spendRound" | "followUpsRemaining" | "followUpCycle" | "signal"
>;

export interface ResearchVerifier {
  verify(findings: readonly BranchExecution[], plan: ResearchPlan): Promise<VerificationSummary>;
}

export interface ResearchRunDeps {
  port: ResearchStatePort;
  runner: BranchRunner;
  subAgents?: ResearchRunSubAgents;
  parallelRequests?: boolean;
  synthesis: ReportSynthesisService;
  createVerifier?(options: ResearchVerifierOptions): ResearchVerifier;
  signal?: AbortSignal;
  resolveEvidence?(revisionIds: readonly string[]): RetrievedChunk[];
  finalizeReport?(markdown: string): string;
  now(): Date;
  setTimer(delayMs: number, callback: () => void): () => void;
  createId(prefix: string): string;
  onState(state: ResearchState): void;
  onStatus(message: string): void;
}

export interface ResearchRunSubAgents {
  attach(port: AttachedResearchBudget): () => void;
  createRunner(sessionOf: (branchId: string) => string | null): BranchRunner;
}

export interface ResearchRunResult {
  state: ResearchState;
  report: ResearchReport | null;
}

/**
 * Executes an approved research from its last barrier to its end within one turn: it reopens the
 * budget, gathers every unsettled work, verifies the findings with follow-ups on the main path,
 * and writes the report from verified claims while finalization rounds remain. The time limit
 * covers the whole turn; a user stop rethrows and leaves the research at its last barrier.
 */
export async function runResearch(
  start: ResearchState,
  deps: ResearchRunDeps,
): Promise<ResearchRunResult> {
  const plan = start.plan!;
  const owner = new ResearchBudgetOwner(
    plan.limits,
    () => deps.now().getTime(),
    plan.branches.filter((branch) => branch.enabled).length,
  );
  owner.open(start.budget);
  const turn = new AbortController();
  const permits = new ResearchBudgetPermits({
    researchId: start.researchId,
    owner,
    sessionCeiling: plan.limits.childSessions,
    sessionByBranch: start.sessionByBranch,
    now: deps.now,
  });
  let current = start;
  const commit = async (patch: Partial<ResearchState>): Promise<ResearchState> => {
    const next: ResearchState = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      budget: owner.snapshot(),
      sessionByBranch: permits.sessionByBranch(),
      updatedAt: deps.now().toISOString(),
    };
    await deps.port.commit(next, current.revision);
    current = next;
    deps.onState(next);
    return next;
  };
  const verifying = start.phase === "verifying";
  await commit({
    phase: verifying ? "verifying" : "gathering",
    executions: resumeExecutions(start.executions),
  });

  const stopTurn = (): void => turn.abort(deps.signal?.reason);
  deps.signal?.addEventListener("abort", stopTurn);
  const closeOnTime = (): void => {
    owner.close("time");
    turn.abort(new DOMException("Research time limit reached", "AbortError"));
  };
  const cancelTimer = deps.setTimer(Math.max(0, owner.remainingMs()), closeOnTime);
  const detach = deps.subAgents?.attach(permits);
  const subAgent = deps.subAgents?.createRunner(
    (branchId) => permits.sessionByBranch()[branchId] ?? null,
  );
  const runners: ResearchSchedulerRunners = {
    main: deps.runner,
    ...(subAgent ? { subAgent } : {}),
    sessionByBranch: () => permits.sessionByBranch(),
  };
  const phase = {
    owner,
    runners,
    waveSize: waveSize(plan.limits, deps.parallelRequests === true),
    turnSignal: turn.signal,
    onStatus: deps.onStatus,
  };
  const stopped = (): boolean => deps.signal?.aborted === true;
  try {
    if (owner.remainingMs() <= 0) closeOnTime();
    await runSchedulingPhase({
      ...phase,
      plan,
      executions: current.executions,
      works: openWorks(current),
      barrier: async (next) => void (await commit({ executions: next })),
    });
    if (stopped()) throw new DOMException("Research stopped", "AbortError");
    if (!verifying) await commit({ phase: "verifying" });
    if (deps.createVerifier && !turn.signal.aborted) {
      deps.onStatus("Verifying the findings…");
      const followUpPlan = {
        ...plan,
        branches: plan.branches.map((branch) => ({ ...branch, dependsOn: [] })),
      };
      const verification = await runVerificationPhase({
        plan,
        executions: () => current.executions,
        verification: current.verification,
        verify: (findings, followUpsRemaining, followUpCycle) =>
          deps.createVerifier!({
            resolveEvidence: deps.resolveEvidence ?? (() => []),
            spendRound: () => owner.spendFinalization(1),
            followUpsRemaining,
            followUpCycle,
            signal: turn.signal,
          }).verify(findings, plan),
        runFollowUps: (followUps, works) =>
          runSchedulingPhase({
            ...phase,
            plan: followUpPlan,
            executions: followUps,
            works,
            barrier: async (next) =>
              void (await commit({
                verification: { ...current.verification!, followUps: [...next] },
              })),
          }),
        commit: async (next) => void (await commit({ verification: next })),
        budgetOpen: () => owner.snapshot().closed === null,
        aborted: () => turn.signal.aborted,
      });
      if (stopped()) throw new DOMException("Research stopped", "AbortError");
      await commit({ verification });
    }
  } catch (error) {
    if (stopped() || !isAbort(error)) throw error;
  } finally {
    detach?.();
    cancelTimer();
    deps.signal?.removeEventListener("abort", stopTurn);
  }
  if (stopped()) throw new DOMException("Research stopped", "AbortError");
  return writeReport(start, current, owner, deps, commit);
}

async function writeReport(
  start: ResearchState,
  current: ResearchState,
  owner: ResearchBudgetOwner,
  deps: ResearchRunDeps,
  commit: (patch: Partial<ResearchState>) => Promise<ResearchState>,
): Promise<ResearchRunResult> {
  const plan = start.plan!;
  await commit({ phase: "synthesizing" });
  const stopReason = stopReasonOf(owner.snapshot());
  const executions = current.executions;
  const verification = current.verification;
  const decision = reportDecision(plan, executions, stopReason, verification);
  if (decision.kind === "failed") {
    const state = await commit({ phase: "failed", terminalReason: boundedReason(decision.reason) });
    return { state, report: null };
  }
  deps.onStatus("Writing the research report…");
  const markdown = await writeReportMarkdown({
    question: start.question,
    plan,
    executions,
    verification,
    stopReason,
    synthesis: deps.synthesis,
    spendRound: () => owner.spendFinalization(1),
    ...(deps.resolveEvidence ? { resolveEvidence: deps.resolveEvidence } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const finalMarkdown = withMissingNote(markdown, decision.missingBranches, plan);
  const report: ResearchReport = {
    reportId: deps.createId("report"),
    quality: decision.quality,
    markdown: deps.finalizeReport?.(finalMarkdown) ?? finalMarkdown,
    completedBranches: decision.completedBranches,
    missingBranches: decision.missingBranches,
    stopReason,
    createdAt: deps.now().toISOString(),
    verification:
      verification && verification.assessments.length > 0
        ? verificationCounts(plan, verification)
        : null,
  };
  const state = await commit({ phase: "completed", report });
  return { state, report };
}

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}
