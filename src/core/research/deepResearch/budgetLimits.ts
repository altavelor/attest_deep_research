import type { ResearchLimits, ResearchPlan } from "./types";

const SCALED_LIMITS = [
  "attemptsTotal",
  "modelRoundsTotal",
  "searchesTotal",
  "evidenceItemsTotal",
  "activeExecutionMs",
] as const satisfies readonly (keyof ResearchLimits)[];

/**
 * Returns the limits a plan runs under: its preset row, with every shared total grown by one
 * preset branch's share for each enabled branch above the preset's branch count. Per-attempt,
 * per-branch, concurrency, cycle and finalization limits never grow.
 */
export function budgetLimits(plan: ResearchPlan): ResearchLimits {
  const { limits } = plan;
  const enabled = plan.branches.filter((branch) => branch.enabled).length;
  const extra = Math.max(0, enabled - limits.branches);
  if (extra === 0 || limits.branches <= 0) return limits;
  const grown = { ...limits };
  for (const key of SCALED_LIMITS) {
    grown[key] = limits[key] + Math.ceil((limits[key] * extra) / limits.branches);
  }
  return grown;
}
