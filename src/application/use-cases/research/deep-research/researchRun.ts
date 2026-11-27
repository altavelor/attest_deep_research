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
  reportScale,
  sourcesFound,
  resumeExecutions,
  researchLanguageOf,
  stopReasonOf,
  waveSize,
  type ResearchActivity,
  type ResearchReport,
  type ResearchLabels,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { BranchRunner } from "./branchRunner";
import type { ReportSynthesisService } from "./ReportSynthesisService";
import { ResearchBudgetPermits } from "./ResearchBudgetPermits";
import type { AttachedResearchBudget } from "./ResearchScopeRouter";
import type { ResearchSchedulerRunners } from "./ResearchScheduler";
import { runSchedulingPhase } from "./researchScheduling";
import { citedSourceCount, withMissingNote, writeReportMarkdown } from "./researchReportWriting";
import { removeUnknownCitationTokens } from "../strategies/citations";
import type { ResearchDiscoveryService } from "./ResearchDiscoveryService";
import { runDiscoveryPhase } from "./researchDiscoveryPhase";
import { isAbort, suppliedObservation, type SuppliedObservation } from "./researchObservation";

export type { SuppliedObservation } from "./researchObservation";
import { researchResumeEntry } from "./researchResume";
import { ResearchActivityReporter } from "./researchActivityReporter";

export interface ResearchDiscoveryFactoryOptions {
  resolveEvidence(tokens: readonly string[]): RetrievedChunk[];
  spendRound(): boolean;
  signal: AbortSignal;
}

export interface ResearchRunDeps {
  port: ResearchStatePort;
  runner: BranchRunner;
  subAgents?: ResearchRunSubAgents;
  parallelRequests?: boolean;
  synthesis: ReportSynthesisService;
  labels: ResearchLabels;
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
  onActivity?(activity: ResearchActivity): void;
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
 * budget, gathers every unsettled work, looks for contradictions between the findings with
 * hypothesis tests, and writes the report from the findings while finalization rounds remain. The time limit
 * covers the whole turn; a user stop rethrows and leaves the research at its last barrier.
 */
export async function runResearch(
  start: ResearchState,
  deps: ResearchRunDeps,
): Promise<ResearchRunResult> {
  const plan = start.plan!;
  const limits = budgetLimits(plan);
  const owner = new ResearchBudgetOwner(
    limits,
    () => deps.now().getTime(),
    plan.branches.filter((branch) => branch.enabled).length,
  );
  owner.open(start.budget);
  const activity = new ResearchActivityReporter(
    start.researchId,
    () => deps.now().getTime(),
    () => owner.snapshot(),
    (next) => deps.onActivity?.(next),
  );
  const turn = new AbortController();
  const permits = new ResearchBudgetPermits({
    researchId: start.researchId,
    owner,
    sessionCeiling: limits.childSessions,
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
  const discovery = deps.createDiscovery?.({
    resolveEvidence: deps.resolveEvidence ?? (() => []),
    spendRound: () => owner.spendDiscovery(1),
    signal: turn.signal,
  });
  if (entry.synthesizing) {
    await commit({ pending: null, executions: resumeExecutions(start.executions) });
    return writeReport(start, current, owner, deps, commit, activity);
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
    releaseSession: (branchId) => permits.releaseSession(branchId),
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
    if (discovery && !turn.signal.aborted) {
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
        onStep: (step) => activity.step("hypotheses", step),
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
  } catch (error) {
    if (stopped() || !isAbort(error)) throw error;
  } finally {
    detach?.();
    cancelTimer();
    deps.signal?.removeEventListener("abort", stopTurn);
  }
  if (stopped()) throw new DOMException("Research stopped", "AbortError");
  return writeReport(start, current, owner, deps, commit, activity);
}

async function writeReport(
  start: ResearchState,
  current: ResearchState,
  owner: ResearchBudgetOwner,
  deps: ResearchRunDeps,
  commit: (patch: Partial<ResearchState>) => Promise<ResearchState>,
  activity: ResearchActivityReporter,
): Promise<ResearchRunResult> {
  const plan = start.plan!;
  if (current.phase !== "synthesizing") await commit({ phase: "synthesizing" });
  const stopReason = stopReasonOf(owner.snapshot(), deps.labels);
  const executions = current.executions;
  const decision = reportDecision(plan, executions, stopReason, deps.labels);
  if (decision.kind === "failed") {
    const state = await commit({ phase: "failed", terminalReason: boundedReason(decision.reason) });
    return { state, report: null };
  }
  deps.onStatus("Writing the research report…");
  activity.step("writing", { kind: "writing", words: 0, headings: [] });
  const written = await writeReportMarkdown({
    question: start.question,
    plan,
    executions,
    discovery: current.discovery ?? null,
    stopReason,
    labels: deps.labels,
    synthesis: deps.synthesis,
    spendRound: () => owner.spendFinalization(1),
    now: deps.now(),
    ...(deps.resolveEvidence ? { resolveEvidence: deps.resolveEvidence } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
    onText: (text, thinking) => activity.writing(text, thinking),
  });
  const { markdown, synthesized, summaryFailure } = written;
  const resolve = deps.resolveEvidence ?? (() => []);
  const hypotheses = synthesized
    ? ""
    : hypothesesSection(current.discovery, deps.labels, (text, allowed) =>
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
  const budget = owner.snapshot();
  const sourcesCited = citedSourceCount(finalMarkdown, deps.resolveEvidence);
  const report: ResearchReport = {
    reportId: deps.createId("report"),
    quality: decision.quality,
    markdown: deps.finalizeReport?.(finalMarkdown) ?? finalMarkdown,
    completedBranches: decision.completedBranches,
    missingBranches: decision.missingBranches,
    stopReason,
    createdAt: deps.now().toISOString(),
    verification: null,
    scale: reportScale(plan, budget.activeMs),
    stats: {
      sourcesFound: sourcesFound(budget, sourcesCited),
      sourcesCited,
      documentsOpened: budget.diagnostics.fetches,
      removedCitations: written.removedCitations,
      uncitedBranches: written.uncitedBranches,
    },
    ...(summaryFailure !== undefined ? { summaryFailure } : {}),
  };
  const state = await commit({ phase: "completed", report });
  return { state, report };
}
