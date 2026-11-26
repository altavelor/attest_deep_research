import { MAX_PLAN_LIST_ITEMS, MAX_RESEARCH_BRANCHES, MAX_RESEARCH_TEXT_CHARS } from "./limits";
import { validatePlan } from "./planValidation";
import type {
  PlanBranchAddition,
  PlanBranchEdit,
  PlanEdit,
  ResearchBranch,
  ResearchPlan,
} from "./types";

export type PlanEditResult =
  { ok: true; plan: ResearchPlan } | { ok: false; code: "research-invalid-plan"; message: string };

/**
 * Applies a manual edit to a plan, producing a new validated revision without a model call. Branch
 * changes, removals, additions and the new order are applied in that order; dependencies on removed
 * or disabled branches are dropped and the objectives left uncovered become known omissions.
 */
export function applyPlanEdit(plan: ResearchPlan, edit: PlanEdit): PlanEditResult {
  const known = new Set(plan.branches.map((branch) => branch.branchId));
  const edits = new Map((edit.branches ?? []).map((entry) => [entry.branchId, entry]));
  const removed = new Set(edit.removed ?? []);
  if ([...edits.keys(), ...removed].some((id) => !known.has(id))) {
    return invalid("The edit names an unknown branch.");
  }
  const kept = plan.branches
    .filter((branch) => !removed.has(branch.branchId))
    .map((branch) => editedBranch(branch, edits.get(branch.branchId)));
  const added = addedBranches(plan.branches, edit.added ?? []);
  const ordered = edit.order ? orderedBranches(kept, added, edit.order) : [...kept, ...added];
  if (!ordered) return invalid("The edit order does not match the branches.");
  const branches = withoutInactiveDependencies(ordered);
  const next: ResearchPlan = {
    ...plan,
    revision: plan.revision + 1,
    branches,
    knownOmissions: omissionsAfterEdit(plan, branches, edit.knownOmissions ?? plan.knownOmissions),
  };
  const problem = validatePlan(next);
  return problem ? invalid(problem) : { ok: true, plan: next };
}

/** Reads the untrusted edit of an edit decision, or returns null when it is malformed. */
export function parsePlanEdit(value: Record<string, unknown>): PlanEdit | null {
  const { branches, added, removed, order, knownOmissions } = value;
  const parsedBranches = branches === undefined ? [] : parseBranchEdits(branches);
  const parsedAdded = added === undefined ? [] : parseBranchAdditions(added);
  const removedValid = removed === undefined || boundedList(removed, isString);
  const orderValid = order === undefined || boundedList(order, isOrderToken, 2);
  const omissionsValid =
    knownOmissions === undefined ||
    (Array.isArray(knownOmissions) &&
      knownOmissions.length <= MAX_PLAN_LIST_ITEMS &&
      knownOmissions.every(boundedText));
  if (!parsedBranches || !parsedAdded || !removedValid || !orderValid || !omissionsValid) {
    return null;
  }
  return {
    branches: parsedBranches,
    ...(parsedAdded.length > 0 ? { added: parsedAdded } : {}),
    ...(removed !== undefined ? { removed: removed as string[] } : {}),
    ...(order !== undefined ? { order: order as (string | number)[] } : {}),
    ...(knownOmissions !== undefined ? { knownOmissions: knownOmissions as string[] } : {}),
  };
}

function invalid(message: string): PlanEditResult {
  return { ok: false, code: "research-invalid-plan", message };
}

function editedBranch(branch: ResearchBranch, change: PlanBranchEdit | undefined): ResearchBranch {
  if (!change) return branch;
  return {
    ...branch,
    ...(change.title !== undefined ? { title: change.title } : {}),
    ...(change.task !== undefined ? { task: change.task } : {}),
    ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
    ...(change.priority !== undefined ? { priority: change.priority } : {}),
  };
}

/**
 * Builds the branches a user added in an edit: optional, independent, tied to no objective, with
 * fresh host identifiers and the widest source scope the plan already uses.
 */
function addedBranches(
  existing: readonly ResearchBranch[],
  additions: readonly PlanBranchAddition[],
): ResearchBranch[] {
  const used = new Set(existing.map((branch) => branch.branchId));
  const scopes = new Set(existing.map((branch) => branch.sourceScope));
  const index = scopes.has("indexAndWeb") || scopes.has("indexOnly");
  const web = scopes.has("indexAndWeb") || scopes.has("webOnly");
  const sourceScope = index && web ? "indexAndWeb" : web ? "webOnly" : "indexOnly";
  let next = existing.length + 1;
  return additions.map((addition) => {
    while (used.has(`branch-${next}`)) next += 1;
    const branchId = `branch-${next}`;
    next += 1;
    return {
      branchId,
      title: addition.title.trim(),
      task: addition.task.trim(),
      expectedOutput: "",
      priority: "optional",
      enabled: true,
      objectives: [],
      sourceScope,
      dependsOn: [],
    };
  });
}

/** Arranges kept branches by identifier and added ones by position; the order must name each once. */
function orderedBranches(
  kept: readonly ResearchBranch[],
  added: readonly ResearchBranch[],
  order: readonly (string | number)[],
): ResearchBranch[] | null {
  const byId = new Map(kept.map((branch) => [branch.branchId, branch]));
  const result = order.map((token) => (typeof token === "number" ? added[token] : byId.get(token)));
  const complete =
    order.length === kept.length + added.length && new Set(order).size === order.length;
  return complete && result.every((branch) => branch !== undefined) ? result : null;
}

/** Drops dependencies on removed branches, and of enabled branches on disabled ones. */
function withoutInactiveDependencies(branches: readonly ResearchBranch[]): ResearchBranch[] {
  const present = new Set(branches.map((branch) => branch.branchId));
  const enabled = new Set(branches.filter((b) => b.enabled).map((b) => b.branchId));
  return branches.map((branch) => {
    const allowed = branch.enabled ? enabled : present;
    return branch.dependsOn.every((id) => allowed.has(id))
      ? branch
      : { ...branch, dependsOn: branch.dependsOn.filter((id) => allowed.has(id)) };
  });
}

/**
 * Records the objectives an edit left without an enabled branch as known omissions, and drops
 * the omissions of objectives that an edit covered again. Objectives untouched by the edit keep
 * their omissions as they were.
 */
function omissionsAfterEdit(
  plan: ResearchPlan,
  branches: readonly ResearchBranch[],
  omissions: readonly string[],
): readonly string[] {
  const covered = (list: readonly ResearchBranch[], objective: string): boolean =>
    list.some((branch) => branch.enabled && branch.objectives.includes(objective));
  const lost = plan.objectives.filter(
    (objective) => covered(plan.branches, objective) && !covered(branches, objective),
  );
  const regained = new Set(
    plan.objectives.filter(
      (objective) => !covered(plan.branches, objective) && covered(branches, objective),
    ),
  );
  const kept = omissions.filter((omission) => !regained.has(omission));
  return [...kept, ...lost.filter((objective) => !kept.includes(objective))];
}

function parseBranchEdits(value: unknown): PlanBranchEdit[] | null {
  if (!Array.isArray(value)) return null;
  const edits: PlanBranchEdit[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.branchId !== "string") return null;
    const { title, task, enabled, priority } = entry;
    if (title !== undefined && !boundedText(title)) return null;
    if (task !== undefined && !boundedText(task)) return null;
    if (enabled !== undefined && typeof enabled !== "boolean") return null;
    if (priority !== undefined && priority !== "required" && priority !== "optional") return null;
    edits.push({
      branchId: entry.branchId,
      ...(title !== undefined ? { title: title as string } : {}),
      ...(task !== undefined ? { task: task as string } : {}),
      ...(enabled !== undefined ? { enabled: enabled as boolean } : {}),
      ...(priority !== undefined ? { priority: priority as "required" | "optional" } : {}),
    });
  }
  return edits;
}

function parseBranchAdditions(value: unknown): PlanBranchAddition[] | null {
  if (!Array.isArray(value) || value.length > MAX_RESEARCH_BRANCHES) return null;
  const additions: PlanBranchAddition[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !boundedText(entry.title) || !boundedText(entry.task)) return null;
    additions.push({ title: entry.title, task: entry.task });
  }
  return additions;
}

function boundedList(value: unknown, item: (entry: unknown) => boolean, factor = 1): boolean {
  return (
    Array.isArray(value) && value.length <= MAX_RESEARCH_BRANCHES * factor && value.every(item)
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOrderToken(value: unknown): value is string | number {
  return isString(value) || (Number.isSafeInteger(value) && (value as number) >= 0);
}

function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_RESEARCH_TEXT_CHARS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
