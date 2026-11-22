import type {
  BranchExecution,
  ResearchBudgetOwner,
  ResearchPlan,
  ResearchWork,
} from "@core/research/deepResearch";
import { ResearchScheduler, type ResearchSchedulerRunners } from "./ResearchScheduler";

export interface SchedulingPhase {
  plan: ResearchPlan;
  executions: readonly BranchExecution[];
  works: readonly ResearchWork[];
  owner: ResearchBudgetOwner;
  runners: ResearchSchedulerRunners;
  waveSize: number;
  turnSignal: AbortSignal;
  barrier(executions: readonly BranchExecution[]): Promise<void>;
  onStatus(message: string): void;
}

/**
 * Runs one scheduling phase of a research turn under its own abort signal, which follows the turn's
 * stop and time signal. Every exit, also a failed barrier, aborts the attempts still in flight and
 * waits until each of them has settled before it returns or rethrows.
 */
export async function runSchedulingPhase(
  phase: SchedulingPhase,
): Promise<readonly BranchExecution[]> {
  const work = new AbortController();
  const follow = (): void => work.abort(phase.turnSignal.reason);
  if (phase.turnSignal.aborted) follow();
  phase.turnSignal.addEventListener("abort", follow);
  const scheduler = new ResearchScheduler({
    plan: phase.plan,
    executions: phase.executions,
    owner: phase.owner,
    runners: phase.runners,
    waveSize: phase.waveSize,
    signal: work.signal,
    barrier: phase.barrier,
    onStatus: phase.onStatus,
  });
  try {
    return await scheduler.run(phase.works);
  } finally {
    if (!work.signal.aborted)
      work.abort(new DOMException("Research scheduling ended", "AbortError"));
    await scheduler.drain();
    phase.turnSignal.removeEventListener("abort", follow);
  }
}
