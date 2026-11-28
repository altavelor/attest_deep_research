import type { ResearchLimits, ResearchPlan } from "./types";

const SCALED_LIMITS = [
  "childSessions",
  "attemptsTotal",
  "modelRoundsTotal",
  "searchesTotal",
  "evidenceItemsTotal",
  "activeExecutionMs",
] as const satisfies readonly (keyof ResearchLimits)[];

/**
 * Returns the limits a plan runs under: its preset row, with every shared total and the child
 * session ceiling grown by one preset branch's share for each enabled branch above the preset's
 * branch count, so added branches keep the preset's share of the totals. A plan that tests
 * hypotheses, each test counting its attempts apart from its branch, gives every branch one more
 * attempt and the total one attempt per planned verification follow-up, as earlier runs stored
 * budgets within these grown limits; the tests may use all of them. Every enabled branch keeps
 * its own child session, so the session ceiling never falls below the number of enabled branches.
 */
export function budgetLimits(plan: ResearchPlan): ResearchLimits {
  const { limits } = plan;
  const enabled = plan.branches.filter((branch) => branch.enabled).length;
  const extra = limits.branches > 0 ? Math.max(0, enabled - limits.branches) : 0;
  const grown = { ...limits };
  for (const key of SCALED_LIMITS) {
    grown[key] = limits[key] + Math.ceil((limits[key] * extra) / Math.max(1, limits.branches));
  }
  grown.childSessions = Math.max(grown.childSessions, enabled);
  if (limits.researchCycles > 1) {
    grown.attemptsPerBranch += 1;
    grown.attemptsTotal += limits.verificationFollowUps;
  }
  return grown;
}
