import type { RetrievedChunk } from "@core/model";
import {
  ResearchBudgetOwner,
  boundedReason,
  formatWithoutModel,
  openWorks,
  reportDecision,
  resumeExecutions,
  stopReasonOf,
  type ResearchReport,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchStatePort } from "@application/ports/researchState";
import type { BranchRunner } from "./branchRunner";
import type { ReportSynthesisService } from "./ReportSynthesisService";
import { ResearchScheduler } from "./ResearchScheduler";

export interface ResearchRunDeps {
  port: ResearchStatePort;
  runner: BranchRunner & { citedEvidence?(): RetrievedChunk[] };
  synthesis: ReportSynthesisService;
  signal?: AbortSignal;
  now(): Date;
  setTimer(delayMs: number, callback: () => void): () => void;
  createId(prefix: string): string;
  onState(state: ResearchState): void;
  onStatus(message: string): void;
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
  const owner = new ResearchBudgetOwner(plan.limits, () => deps.now().getTime());
  owner.open(start.budget);
  let current = start;
  const commit = async (patch: Partial<ResearchState>): Promise<ResearchState> => {
    const next: ResearchState = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      budget: owner.snapshot(),
      updatedAt: deps.now().toISOString(),
    };
    await deps.port.commit(next, current.revision);
    current = next;
    deps.onState(next);
    return next;
  };
  await commit({ phase: "gathering", executions: resumeExecutions(start.executions) });

  const work = new AbortController();
  const stopWork = (): void => work.abort(deps.signal?.reason);
  deps.signal?.addEventListener("abort", stopWork);
  const closeOnTime = (): void => {
    owner.close("time");
    work.abort(new DOMException("Research time limit reached", "AbortError"));
  };
  const cancelTimer = deps.setTimer(Math.max(0, owner.remainingMs()), closeOnTime);
  let executions;
  try {
    if (owner.remainingMs() <= 0) closeOnTime();
    executions = await new ResearchScheduler({
      plan,
      executions: current.executions,
      owner,
      runner: deps.runner,
      signal: work.signal,
      barrier: async (next) => void (await commit({ executions: next })),
      onStatus: deps.onStatus,
    }).run(openWorks(current));
  } finally {
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
  let markdown = formatWithoutModel(plan, executions, stopReason);
  if (owner.spendFinalization(1)) {
    try {
      const synthesized = await deps.synthesis.synthesize({
        question: start.question,
        plan,
        executions,
        evidence: deps.runner.citedEvidence?.() ?? [],
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      markdown = withCitationNotes(synthesized.markdown, synthesized);
    } catch (error) {
      if (deps.signal?.aborted) throw error;
    }
  }
  const report: ResearchReport = {
    reportId: deps.createId("report"),
    quality: decision.quality,
    markdown: withMissingNote(markdown, decision.missingBranches, plan),
    completedBranches: decision.completedBranches,
    missingBranches: decision.missingBranches,
    stopReason,
    createdAt: deps.now().toISOString(),
  };
  const state = await commit({ phase: "completed", report });
  return { state, report };
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
