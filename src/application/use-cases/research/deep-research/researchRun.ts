import type { RetrievedChunk } from "@core/model";
import {
  ResearchBudgetOwner,
  boundedReason,
  formatWithoutModel,
  openWorks,
  reportDecision,
  resumeExecutions,
  stopReasonOf,
  waveSize,
  type BranchExecution,
  type ResearchReport,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { BranchRunner } from "./branchRunner";
import type { ReportSynthesisService } from "./ReportSynthesisService";
import { ResearchScheduler } from "./ResearchScheduler";
import { ResearchBudgetPermits } from "./ResearchBudgetPermits";
import type { AttachedResearchBudget } from "./ResearchScopeRouter";
import { removeUnknownCitationTokens } from "../strategies/citations";

export interface ResearchRunDeps {
  port: ResearchStatePort;
  runner: BranchRunner;
  subAgents?: ResearchRunSubAgents;
  parallelRequests?: boolean;
  synthesis: ReportSynthesisService;
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
 * budget, runs every unsettled work through the scheduler under the active time limit, and writes
 * the report with the model while finalization rounds remain or without it otherwise. A user stop
 * rethrows and leaves the research paused at its last committed barrier.
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
  const work = new AbortController();
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
  await commit({ phase: "gathering", executions: resumeExecutions(start.executions) });

  const stopWork = (): void => work.abort(deps.signal?.reason);
  deps.signal?.addEventListener("abort", stopWork);
  const closeOnTime = (): void => {
    owner.close("time");
    work.abort(new DOMException("Research time limit reached", "AbortError"));
  };
  const cancelTimer = deps.setTimer(Math.max(0, owner.remainingMs()), closeOnTime);
  const detach = deps.subAgents?.attach(permits);
  const subAgent = deps.subAgents?.createRunner(
    (branchId) => permits.sessionByBranch()[branchId] ?? null,
  );
  const scheduler = new ResearchScheduler({
    plan,
    executions: current.executions,
    owner,
    runners: {
      main: deps.runner,
      ...(subAgent ? { subAgent } : {}),
      sessionByBranch: () => permits.sessionByBranch(),
    },
    waveSize: waveSize(plan.limits, deps.parallelRequests === true),
    signal: work.signal,
    barrier: async (next) => void (await commit({ executions: next })),
    onStatus: deps.onStatus,
  });
  let executions;
  try {
    if (owner.remainingMs() <= 0) closeOnTime();
    executions = await scheduler.run(openWorks(current));
  } finally {
    if (!work.signal.aborted)
      work.abort(new DOMException("Research scheduling ended", "AbortError"));
    await scheduler.drain();
    detach?.();
    cancelTimer();
    deps.signal?.removeEventListener("abort", stopWork);
  }
  if (deps.signal?.aborted) throw new DOMException("Research stopped", "AbortError");

  await commit({ phase: "synthesizing" });
  const stopReason = stopReasonOf(owner.snapshot());
  const decision = reportDecision(plan, executions, stopReason);
  if (decision.kind === "failed") {
    const state = await commit({ phase: "failed", terminalReason: boundedReason(decision.reason) });
    return { state, report: null };
  }
  deps.onStatus("Writing the research report…");
  const cited = registryCitedFindings(executions, deps.resolveEvidence);
  let markdown = withCitationNotes(formatWithoutModel(plan, cited.executions, stopReason), {
    removedTokens: cited.removedTokens,
    unverifiedTokens: 0,
  });
  if (owner.spendFinalization(1)) {
    try {
      const synthesized = await deps.synthesis.synthesize({
        question: start.question,
        plan,
        executions: cited.executions,
        evidence: cited.evidence,
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      markdown = withCitationNotes(synthesized.markdown, {
        removedTokens: synthesized.removedTokens + cited.removedTokens,
        unverifiedTokens: synthesized.unverifiedTokens,
      });
    } catch (error) {
      if (deps.signal?.aborted) throw error;
    }
  }
  const finalMarkdown = withMissingNote(markdown, decision.missingBranches, plan);
  const report: ResearchReport = {
    reportId: deps.createId("report"),
    quality: decision.quality,
    markdown: deps.finalizeReport?.(finalMarkdown) ?? finalMarkdown,
    completedBranches: decision.completedBranches,
    missingBranches: decision.missingBranches,
    stopReason,
    createdAt: deps.now().toISOString(),
  };
  const state = await commit({ phase: "completed", report });
  return { state, report };
}

/**
 * Keeps only the finding citations that resolve in the conversation source registry: unresolved
 * tokens leave the finding text and its listed sources and are counted, and the resolved revisions
 * become the evidence the report is verified against.
 */
function registryCitedFindings(
  executions: readonly BranchExecution[],
  resolve: ResearchRunDeps["resolveEvidence"],
): { executions: BranchExecution[]; evidence: RetrievedChunk[]; removedTokens: number } {
  const stored = executions.flatMap((execution) => execution.finding?.citationTokens ?? []);
  const evidence = resolve?.(stored) ?? [];
  const known = new Set(evidence.map((chunk) => chunk.id));
  let removedTokens = 0;
  const cited = executions.map((execution) => {
    const finding = execution.finding;
    if (!finding) return execution;
    const unknown = new Set(finding.citationTokens.filter((token) => !known.has(token)));
    removedTokens += unknown.size;
    return {
      ...execution,
      finding: {
        ...finding,
        text: removeUnknownCitationTokens(finding.text, known),
        citationTokens: finding.citationTokens.filter((token) => known.has(token)),
      },
    };
  });
  return { executions: cited, evidence, removedTokens };
}

function withCitationNotes(
  markdown: string,
  counts: { removedTokens: number; unverifiedTokens: number },
): string {
  const notes = [
    counts.removedTokens > 0
      ? `${counts.removedTokens} citation(s) without a source in the findings were removed.`
      : "",
    counts.unverifiedTokens > 0
      ? `${counts.unverifiedTokens} citation(s) could not be verified against the cited source text.`
      : "",
  ].filter((note) => note !== "");
  return notes.length > 0 ? `${markdown}\n\n> ${notes.join(" ")}` : markdown;
}

function withMissingNote(
  markdown: string,
  missing: readonly { branchId: string; reason: string }[],
  plan: NonNullable<ResearchState["plan"]>,
): string {
  const required = missing.filter(
    (entry) =>
      plan.branches.find((branch) => branch.branchId === entry.branchId)?.priority === "required",
  );
  if (required.length === 0) return markdown;
  const names = required.map(
    (entry) =>
      plan.branches.find((branch) => branch.branchId === entry.branchId)?.title ?? entry.branchId,
  );
  return `> Partial report: required branches are missing (${names.join(", ")}).\n\n${markdown}`;
}
