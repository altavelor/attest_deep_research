import {
  MAX_PLAN_GENERATIONS,
  MAX_PLAN_LIST_ITEMS,
  MAX_RESEARCH_BRANCHES,
  RESEARCH_PRESET_LIMITS,
} from "./limits";
import type { ResearchBranch, ResearchLimits, ResearchPlan } from "./types";

const RESEARCH_ID = /^[A-Za-z0-9_-]{1,64}$/u;

/** Tells whether a value is a bounded host-generated research identifier. */
export function isResearchId(value: unknown): value is string {
  return typeof value === "string" && RESEARCH_ID.test(value);
}

/** Tells whether a value is a checked non-negative safe integer revision or counter. */
export function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Returns how many enabled branches the plan's preset lets it run. */
export function maxEnabledBranches(plan: ResearchPlan): number {
  return Math.min(MAX_RESEARCH_BRANCHES, plan.limits.branches);
}

/**
 * Checks the semantic rules of a plan and returns the first violation as readable text, or null.
 * Branch identity, dependency graph, enablement, objective coverage and the preset limits row
 * are all checked; untrusted plan content can therefore never raise limits.
 */
export function validatePlan(plan: ResearchPlan): string | null {
  const { branches } = plan;
  if (!sameLimits(plan.limits, RESEARCH_PRESET_LIMITS[plan.preset])) {
    return "The plan limits differ from its preset.";
  }
  if (!isRevision(plan.generationsUsed) || plan.generationsUsed > MAX_PLAN_GENERATIONS) {
    return "The plan used more generations than allowed.";
  }
  if (
    [plan.objectives, plan.reportOutline, plan.knownOmissions].some(
      (list) => list.length > MAX_PLAN_LIST_ITEMS,
    )
  ) {
    return `A plan list holds at most ${MAX_PLAN_LIST_ITEMS} entries.`;
  }
  if (branches.length === 0 || branches.length > MAX_RESEARCH_BRANCHES) {
    return `A plan needs between one and ${MAX_RESEARCH_BRANCHES} branches.`;
  }
  const maxEnabled = maxEnabledBranches(plan);
  if (branches.filter((branch) => branch.enabled).length > maxEnabled) {
    return `A plan runs at most ${maxEnabled} enabled branches; disable or remove one.`;
  }
  const byId = new Map<string, ResearchBranch>();
  for (const branch of branches) {
    if (!isResearchId(branch.branchId) || byId.has(branch.branchId)) {
      return "Every branch needs a unique identifier.";
    }
    if (branch.task.trim() === "" || branch.title.trim() === "") {
      return "Every branch needs a title and a task.";
    }
    byId.set(branch.branchId, branch);
  }
  const objectives = new Set(plan.objectives);
  for (const branch of branches) {
    if (
      branch.objectives.length > MAX_PLAN_LIST_ITEMS ||
      branch.dependsOn.length > branches.length
    ) {
      return `Branch "${branch.title}" lists too many objectives or dependencies.`;
    }
    if (branch.objectives.some((objective) => !objectives.has(objective))) {
      return `Branch "${branch.title}" refers to an unknown objective.`;
    }
    for (const dependency of branch.dependsOn) {
      const target = byId.get(dependency);
      if (!target) return `Branch "${branch.title}" depends on an unknown branch.`;
      if (branch.enabled && !target.enabled) {
        return `Branch "${branch.title}" depends on a disabled branch.`;
      }
    }
  }
  if (!branches.some((branch) => branch.enabled)) return "Enable at least one branch.";
  if (hasCycle(branches, byId)) return "Branch dependencies form a cycle.";
  return uncoveredObjective(plan);
}

function sameLimits(left: ResearchLimits, right: ResearchLimits | undefined): boolean {
  if (!right) return false;
  const keys = Object.keys(right) as (keyof ResearchLimits)[];
  return Object.keys(left).length === keys.length && keys.every((key) => left[key] === right[key]);
}

function hasCycle(
  branches: readonly ResearchBranch[],
  byId: ReadonlyMap<string, ResearchBranch>,
): boolean {
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): boolean => {
    const mark = state.get(id);
    if (mark === "visiting") return true;
    if (mark === "done") return false;
    state.set(id, "visiting");
    const cyclic = (byId.get(id)?.dependsOn ?? []).some(visit);
    state.set(id, "done");
    return cyclic;
  };
  return branches.some((branch) => visit(branch.branchId));
}

function uncoveredObjective(plan: ResearchPlan): string | null {
  const omitted = new Set(plan.knownOmissions);
  for (const objective of plan.objectives) {
    const covering = plan.branches.filter((branch) => branch.objectives.includes(objective));
    const lostRequired =
      covering.some((branch) => branch.priority === "required" && !branch.enabled) &&
      !covering.some((branch) => branch.enabled);
    if (lostRequired && !omitted.has(objective)) {
      return `Objective "${objective}" loses its required branch; record it as a known omission.`;
    }
  }
  return null;
}
