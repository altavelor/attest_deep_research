import type { RetrievedChunk } from "@core/model";
import {
  ResearchBudgetOwner,
  budgetLimits,
  boundTestExecution,
  boundedReason,
  hypothesesSection,
  isPlanStale,
  openWorks,
  reportDecision,
  resumeExecutions,
  researchLanguageOf,
  stopReasonOf,
  verificationCounts,
  waveSize,
  type BranchExecution,
  type ResearchPlan,
  type ResearchReport,
  type ResearchDiscovery,
  type ResearchLabels,
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
import { removeUnknownCitationTokens } from "../strategies/citations";
import type { ResearchDiscoveryService } from "./ResearchDiscoveryService";
import {
  runDiscoveryPhase,
  withObservation,
  withObservationsSkipped,
} from "./researchDiscoveryPhase";
import { researchResumeEntry } from "./researchResume";

export interface ResearchDiscoveryFactoryOptions {
  resolveEvidence(tokens: readonly string[]): RetrievedChunk[];
  spendRound(): boolean;
  signal: AbortSignal;
}

export interface SuppliedObservation {
  testId: string;
  text: string | null;
}

export type ResearchVerifierOptions = Pick<
  EvidenceVerificationOptions,
  | "resolveEvidence"
  | "spendRound"
  | "followUpsRemaining"
  | "followUpCycle"
  | "claimAllowance"
  | "onExtracted"
  | "hypothesisClaims"
  | "signal"
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
  labels: ResearchLabels;
  createVerifier?(options: ResearchVerifierOptions): ResearchVerifier;
  createDiscovery?(options: ResearchDiscoveryFactoryOptions): ResearchDiscoveryService;
  observation?: SuppliedObservation;
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
    budgetLimits(plan),
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
  const entry = researchResumeEntry(start);
  const { verifying } = entry;
  const discovery = deps.createDiscovery?.({
    resolveEvidence: deps.resolveEvidence ?? (() => []),
    spendRound: () => owner.spendDiscovery(1),
    signal: turn.signal,
  });
  if (entry.synthesizing) {
    await commit({ pending: null, executions: resumeExecutions(start.executions) });
    return writeReport(start, current, owner, deps, commit);
  }

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
    language: researchLanguageOf(start),
    labels: deps.labels,
    owner,
    runners,
    waveSize: waveSize(plan.limits, deps.parallelRequests === true),
    turnSignal: turn.signal,
    setTimer: deps.setTimer,
    onStatus: deps.onStatus,
  };
  const stopped = (): boolean => deps.signal?.aborted === true;
  try {
    if (stopped()) throw new DOMException("Research stopped", "AbortError");
    if (owner.remainingMs() <= 0) closeOnTime();
    const observed =
      deps.observation && discovery && start.discovery
        ? await suppliedObservation(start, deps.observation, discovery, stopped)
        : start.discovery;
    await commit({
      phase: entry.phase,
      pending: null,
      executions: resumeExecutions(start.executions),
      discovery: observed,
    });
    if (deps.observation && isPlanStale(plan, deps.now().toISOString())) {
      const state = await commit({
        pending: {
          decisionId: deps.createId("decision"),
          kind: "stale-plan",
          artifactRevision: plan.revision,
        },
      });
      return { state, report: null };
    }
    await runSchedulingPhase({
      ...phase,
      plan,
      executions: current.executions,
      works: openWorks(current),
      barrier: async (next) => void (await commit({ executions: next })),
    });
    if (stopped()) throw new DOMException("Research stopped", "AbortError");
    if (discovery && !verifying && !turn.signal.aborted) {
      deps.onStatus("Testing hypotheses…");
      const testPlan = {
        ...plan,
        branches: plan.branches.map((branch) => ({ ...branch, dependsOn: [] })),
      };
      const result = await runDiscoveryPhase({
        question: start.question,
        plan,
        gathered: current.executions,
        discovery: current.discovery,
        service: discovery,
        runTests: async (executions, works) =>
          (
            await runSchedulingPhase({
              ...phase,
              plan: testPlan,
              executions,
              works,
              barrier: async (next) =>
                void (await commit({
                  discovery: {
                    ...current.discovery!,
                    executions: next.map(boundTestExecution),
                  },
                })),
            })
          ).map(boundTestExecution),
        commit: async (next) => void (await commit({ phase: "discovering", discovery: next })),
        budgetClosed: () => owner.snapshot().closed !== null,
        aborted: () => turn.signal.aborted,
      });
      if (stopped()) throw new DOMException("Research stopped", "AbortError");
      if (result.decision === "await-observation") {
        const test = result.discovery.tests.find((entry) => entry.status === "awaiting-input")!;
        const state = await commit({
          phase: "awaiting-observation",
          pending: {
            decisionId: deps.createId("decision"),
            kind: "observation",
            artifactRevision: test.hypothesisRevision,
            subjectId: test.testId,
          },
        });
        return { state, report: null };
      }
    }
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
        discovery: current.discovery,
        verify: async (findings, bounds) => {
          let extractedWorks: readonly string[] = [];
          const summary = await deps.createVerifier!({
            resolveEvidence: deps.resolveEvidence ?? (() => []),
            spendRound: () => owner.spendFinalization(1),
            followUpsRemaining: bounds.followUpsRemaining,
            followUpCycle: bounds.cycle,
            claimAllowance: bounds.claimAllowance,
            onExtracted: (workIds) => (extractedWorks = workIds),
            hypothesisClaims: bounds.hypothesisClaims,
            signal: turn.signal,
          }).verify(findings, plan);
          return { summary, extractedWorks };
        },
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
  if (current.phase !== "synthesizing") await commit({ phase: "synthesizing" });
  const stopReason = stopReasonOf(owner.snapshot(), deps.labels);
  const executions = current.executions;
  const verification = current.verification;
  const decision = reportDecision(plan, executions, stopReason, verification, deps.labels);
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
    labels: deps.labels,
    synthesis: deps.synthesis,
    spendRound: () => owner.spendFinalization(1),
    ...(deps.resolveEvidence ? { resolveEvidence: deps.resolveEvidence } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const resolve = deps.resolveEvidence ?? (() => []);
  const hypotheses = hypothesesSection(current.discovery, deps.labels, (text, allowed) =>
    removeUnknownCitationTokens(
      text,
      new Set([...allowed].filter((token) => resolve([token]).length > 0)),
    ),
  );
  const finalMarkdown = withMissingNote(
    hypotheses === "" ? markdown : `${markdown}\n\n${hypotheses}`,
    decision.missingBranches,
    plan,
    deps.labels,
  );
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

/**
 * Assesses a supplied observation; when the time limit interrupts the judgement, it is kept as
 * inconclusive. An observation without text skips the observation stage of the research.
 */
async function suppliedObservation(
  start: ResearchState,
  supplied: SuppliedObservation,
  service: ResearchDiscoveryService,
  stopped: () => boolean,
): Promise<ResearchDiscovery> {
  const discovery = start.discovery!;
  if (supplied.text === null) {
    return withObservationsSkipped(discovery, discovery.cycles.at(-1)!.ordinal);
  }
  const test = discovery.tests.find((entry) => entry.testId === supplied.testId)!;
  const hypothesis = discovery.hypotheses.find(
    (entry) =>
      entry.hypothesisId === test.hypothesisId && entry.revision === test.hypothesisRevision,
  )!;
  try {
    return withObservation(discovery, await service.assessReport(hypothesis, test, supplied.text));
  } catch (error) {
    if (stopped() || !isAbort(error)) throw error;
    return withObservation(discovery, service.unjudgedReport(test, supplied.text));
  }
}

function isAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError";
}
