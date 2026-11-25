import type { ResearchActivity, ResearchStage } from "./activity";
import type { ResearchPhase, ResearchPlan, ResearchState } from "./types";

export type ResearchStageStatus = "done" | "running" | "pending" | "skipped";

export interface ResearchStageRow {
  stage: ResearchStage;
  status: ResearchStageStatus;
}

const PHASE_ORDER: Partial<Record<ResearchPhase, number>> = {
  gathering: 0,
  discovering: 1,
  "awaiting-observation": 1,
  verifying: 2,
  synthesizing: 3,
  completed: 4,
};

/**
 * Lists the stages that follow the gather wave of an approved research with their status. The
 * hypothesis stage exists when the plan allows more than one research cycle or hypotheses were
 * proposed, and the follow-up stage when the plan allows follow-ups. While follow-ups run, the
 * verification that requested them counts as done; a follow-up stage that never ran is skipped.
 */
export function researchStages(
  state: ResearchState,
  plan: ResearchPlan,
  activity: ResearchActivity | null,
): ResearchStageRow[] {
  const order = PHASE_ORDER[state.phase] ?? 0;
  const followUps = state.verification?.followUps ?? [];
  const followingUp =
    order === 2 &&
    (activity?.stage === "follow-ups" ||
      followUps.some((entry) => entry.state === "pending" || entry.state === "running"));
  const rows: ResearchStageRow[] = [];
  if (plan.limits.researchCycles > 1 || (state.discovery?.hypotheses.length ?? 0) > 0) {
    rows.push({ stage: "hypotheses", status: byOrder(order, 1) });
  }
  rows.push({
    stage: "verification",
    status: followingUp ? "done" : byOrder(order, 2),
  });
  if (plan.limits.verificationFollowUps > 0) {
    const ran = followUps.length > 0;
    let status: ResearchStageStatus = "pending";
    if (followingUp) status = "running";
    else if (order > 2) status = ran ? "done" : "skipped";
    else if (order === 2 && ran) status = "done";
    rows.push({ stage: "follow-ups", status });
  }
  rows.push({ stage: "writing", status: byOrder(order, 3) });
  return rows;
}

/** Returns the 1-based number of the stage a research is in, counting finished stages. */
export function currentStageNumber(rows: readonly ResearchStageRow[]): number {
  const running = rows.findIndex((row) => row.status === "running");
  if (running >= 0) return running + 1;
  const settled = rows.filter((row) => row.status === "done" || row.status === "skipped").length;
  return Math.min(rows.length, settled + 1);
}

function byOrder(order: number, own: number): ResearchStageStatus {
  if (order > own) return "done";
  return order === own ? "running" : "pending";
}
