import type { Translate } from "@adapters/i18n";
import {
  MAX_PLAN_GENERATIONS,
  type ResearchBranch,
  type ResearchPlan,
} from "@core/research/deepResearch";

/**
 * Renders the read-only plan: its revision line, the ordered branch list and the known omissions.
 * The branch renderer lets the editor replace the title and task with fields; the list is returned.
 */
export function renderPlan(
  cardEl: HTMLElement,
  plan: ResearchPlan,
  t: Translate,
  renderBranch: (itemEl: HTMLElement, branch: ResearchBranch) => void = renderBranchText,
): HTMLOListElement {
  cardEl.createDiv({ cls: "attest-research-card__title", text: t("chat.deepResearch.card.title") });
  cardEl.createDiv({
    cls: "attest-research-card__meta",
    text: t("chat.deepResearch.card.meta", {
      revision: plan.revision,
      used: plan.generationsUsed,
      max: MAX_PLAN_GENERATIONS,
    }),
  });
  const listEl = cardEl.createEl("ol", { cls: "attest-research-card__branches" });
  const titles = new Map(plan.branches.map((branch) => [branch.branchId, branch.title]));
  for (const branch of plan.branches) {
    const itemEl = listEl.createEl("li", {
      cls: `attest-research-card__branch${branch.enabled ? "" : " attest-research-card__branch--disabled"}`,
    });
    renderBranch(itemEl, branch);
    const notes = [
      branch.priority === "optional" ? t("chat.deepResearch.card.optional") : "",
      branch.dependsOn.length > 0
        ? t("chat.deepResearch.card.dependsOn", {
            branches: branch.dependsOn.map((id) => titles.get(id) ?? id).join(", "),
          })
        : "",
    ].filter((note) => note !== "");
    if (notes.length > 0) {
      itemEl.createDiv({ cls: "attest-research-card__branch-notes", text: notes.join(" · ") });
    }
  }
  if (plan.knownOmissions.length > 0) {
    cardEl.createDiv({
      cls: "attest-research-card__meta",
      text: t("chat.deepResearch.card.omissions", { items: plan.knownOmissions.join("; ") }),
    });
  }
  return listEl;
}

function renderBranchText(itemEl: HTMLElement, branch: ResearchBranch): void {
  itemEl.createDiv({ cls: "attest-research-card__branch-title", text: branch.title });
  itemEl.createDiv({ cls: "attest-research-card__branch-task", text: branch.task });
}
