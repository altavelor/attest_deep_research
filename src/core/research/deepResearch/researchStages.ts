import type { ResearchStage } from "./activity";
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
 * proposed; the report is always written last.
 */
export function researchStages(state: ResearchState, plan: ResearchPlan): ResearchStageRow[] {
  const order = PHASE_ORDER[state.phase] ?? 0;
  const rows: ResearchStageRow[] = [];
  if (plan.limits.researchCycles > 1 || (state.discovery?.hypotheses.length ?? 0) > 0) {
    rows.push({ stage: "hypotheses", status: byOrder(order, 1) });
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
