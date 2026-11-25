import type { Translate } from "@adapters/i18n";
import {
  MAX_PLAN_GENERATIONS,
  type ResearchBranch,
  type ResearchPlan,
} from "@core/research/deepResearch";

export const DISABLED_BRANCH = "attest-research-card__branch--disabled";

/** Renders the read-only plan: its header, the ordered branch list and the known omissions. */
export function renderPlan(cardEl: HTMLElement, plan: ResearchPlan, t: Translate): void {
  renderPlanHeader(cardEl, plan, t);
  const listEl = cardEl.createEl("ol", { cls: "attest-research-card__branches" });
  for (const branch of plan.branches) {
    const itemEl = listEl.createEl("li", { cls: branchClass(branch.enabled) });
    itemEl.createDiv({ cls: "attest-research-card__branch-title", text: branch.title });
    itemEl.createDiv({ cls: "attest-research-card__branch-task", text: branch.task });
    const notes = [
      branch.priority === "optional" ? t("chat.deepResearch.card.optional") : "",
      dependencyNote(plan, branch, t),
    ].filter((note) => note !== "");
    if (notes.length > 0) {
      itemEl.createDiv({ cls: "attest-research-card__branch-notes", text: notes.join(" · ") });
    }
  }
  if (plan.knownOmissions.length === 0) return;
  cardEl.createDiv({
    cls: "attest-research-card__meta",
    text: t("chat.deepResearch.card.omissions"),
  });
  const omissionsEl = cardEl.createEl("ul", { cls: "attest-research-card__omissions" });
  for (const omission of plan.knownOmissions) omissionsEl.createEl("li", { text: omission });
}

/** Renders the plan title and its revision and generation line. */
export function renderPlanHeader(cardEl: HTMLElement, plan: ResearchPlan, t: Translate): void {
  cardEl.createDiv({ cls: "attest-research-card__title", text: t("chat.deepResearch.card.title") });
  cardEl.createDiv({
    cls: "attest-research-card__meta",
    text: t("chat.deepResearch.card.meta", {
      revision: plan.revision,
      used: plan.generationsUsed,
      max: MAX_PLAN_GENERATIONS,
    }),
  });
}

/** Describes the branches a branch waits for, or returns an empty string when it waits for none. */
export function dependencyNote(plan: ResearchPlan, branch: ResearchBranch, t: Translate): string {
  if (branch.dependsOn.length === 0) return "";
  const titles = new Map(plan.branches.map((entry) => [entry.branchId, entry.title]));
  return t("chat.deepResearch.card.dependsOn", {
    branches: branch.dependsOn.map((id) => titles.get(id) ?? id).join(", "),
  });
}

/** Returns the list-item class of a branch, struck through when it is disabled. */
export function branchClass(enabled: boolean): string {
  return `attest-research-card__branch${enabled ? "" : ` ${DISABLED_BRANCH}`}`;
}
