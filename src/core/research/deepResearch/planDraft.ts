import { RESEARCH_LANGUAGE_RULE } from "./researchLanguage";
import { MAX_PLAN_LIST_ITEMS, MAX_RESEARCH_BRANCHES, presetLimits } from "./limits";
import { maxGeneratedBranches, validatePlan } from "./planValidation";
import type {
  ResearchBranch,
  ResearchPlan,
  ResearchPreset,
  ResearchRuleResult,
  ResearchSourceScope,
} from "./types";

export interface PlanDraftContext {
  planId: string;
  preset: ResearchPreset;
  chatScope: ResearchSourceScope;
  generationsUsed: number;
}

const MAX_TITLE = 200;
const MAX_TEXT = 2000;

/** Builds the system prompt asking the model for a reviewable research plan as JSON. */
export function planGenerationPrompt(maxBranches: number): string {
  return [
    "You plan a multi-branch research task. Reply with one JSON object only, no prose.",
    'Shape: {"objectives": string[], "reportOutline": string[], "knownOmissions": string[],',
    '"branches": [{"title": string, "task": string, "expectedOutput": string,',
    '"priority": "required" | "optional", "objectives": number[], "dependsOn": number[],',
    '"sourceScope": "indexOnly" | "webOnly" | "indexAndWeb"}]}.',
    "Objective and dependency numbers are 1-based positions in their lists.",
    `Use between 1 and ${maxBranches} branches; tasks must be self-contained instructions.`,
    RESEARCH_LANGUAGE_RULE,
  ].join("\n");
}

/**
 * Turns untrusted model output into a validated plan. Identifiers are host-generated, text is
 * bounded, the source scope never exceeds the chat's scope, and the limits are the preset row.
 */
export function parsePlanDraft(
  text: string,
  context: PlanDraftContext,
): ResearchRuleResult<ResearchPlan> {
  const raw = firstJsonObject(text);
  if (!raw) return { ok: false, message: "The model did not return a plan." };
  const rawObjectives = rawTexts(raw.objectives, MAX_TEXT);
  const objectives = distinct(rawObjectives);
  const branchValues = Array.isArray(raw.branches)
    ? raw.branches.slice(0, MAX_RESEARCH_BRANCHES + 1)
    : [];
  const branches: ResearchBranch[] = [];
  for (const [index, value] of branchValues.entries()) {
    if (!isRecord(value)) return { ok: false, message: "The plan has a malformed branch." };
    branches.push({
      branchId: `branch-${index + 1}`,
      title: boundedText(value.title, MAX_TITLE),
      task: boundedText(value.task, MAX_TEXT),
      expectedOutput: boundedText(value.expectedOutput, MAX_TEXT),
      priority: value.priority === "optional" ? "optional" : "required",
      enabled: true,
      objectives: distinct(
        positions(value.objectives, rawObjectives.length).map((at) => rawObjectives[at]!),
      ),
      sourceScope: clampScope(value.sourceScope, context.chatScope),
      dependsOn: positions(value.dependsOn, branchValues.length).map((at) => `branch-${at + 1}`),
    });
  }
  const plan: ResearchPlan = {
    planId: context.planId,
    revision: 1,
    objectives,
    reportOutline: textList(raw.reportOutline, MAX_TITLE),
    branches,
    knownOmissions: textList(raw.knownOmissions, MAX_TEXT),
    preset: context.preset,
    limits: presetLimits(context.preset),
    generationsUsed: context.generationsUsed,
    approvedAt: null,
  };
  const generated = maxGeneratedBranches(context.preset);
  if (branches.length > generated) {
    return { ok: false, message: `A generated plan has at most ${generated} branches.` };
  }
  const problem = validatePlan(plan);
  return problem ? { ok: false, message: problem } : { ok: true, value: plan };
}

function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function clampScope(value: unknown, chatScope: ResearchSourceScope): ResearchSourceScope {
  if (chatScope !== "indexAndWeb") return chatScope;
  return value === "indexOnly" || value === "webOnly" ? value : "indexAndWeb";
}

function positions(value: unknown, length: number): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (Number.isSafeInteger(entry) && entry >= 1 && entry <= length) seen.add(entry - 1);
  }
  return [...seen];
}

function rawTexts(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.map((entry) => boundedText(entry, max)) : [];
}

function distinct(items: readonly string[]): string[] {
  return [...new Set(items.filter((entry) => entry !== ""))].slice(0, MAX_PLAN_LIST_ITEMS);
}

function textList(value: unknown, max: number): string[] {
  return distinct(rawTexts(value, max));
}

function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
