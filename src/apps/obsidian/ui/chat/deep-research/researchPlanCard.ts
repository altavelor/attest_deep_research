import type { Translate } from "@adapters/i18n";
import {
  MAX_PLAN_GENERATIONS,
  MAX_RESEARCH_TEXT_CHARS,
  canRegenerate,
  isResearchId,
  isRevision,
  type ResearchArtifactReference,
  type ResearchBranch,
  type ResearchPlan,
  type ResearchState,
  type ResearchTurnInput,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { cancelAction, renderActions, turnKey } from "./researchCardActions";
import { renderEndedResearch, renderProgress } from "./researchProgressCard";
import { renderBrief } from "./researchBriefCard";

export type { ResearchCardContext } from "./researchCardContext";

/**
 * Renders the card of one research reference from the current section state. Only the card of
 * the current revision of a pending plan has controls; every other card is read-only, and a sent
 * turn stays disabled across rerenders so a double click never sends a second decision.
 */
export function renderResearchCard(
  containerEl: HTMLElement,
  reference: unknown,
  context: ResearchCardContext,
): void {
  if (!isReference(reference)) return;
  const { view, t } = context;
  const cardEl = containerEl.createDiv({ cls: "attest-research-card" });
  if (view.status === "unreadable") {
    cardEl.createDiv({
      cls: "attest-research-card__notice attest-research-card__notice--error",
      text: t("chat.deepResearch.unreadable", { reason: view.reason }),
    });
    return;
  }
  const active = view.active?.researchId === reference.researchId ? view.active : null;
  if (!active) {
    renderEndedResearch(
      cardEl,
      view.history.find((entry) => entry.researchId === reference.researchId),
      t,
      context.exports,
    );
    return;
  }
  if (active.revision !== reference.revision) {
    cardEl.createDiv({
      cls: "attest-research-card__notice",
      text: t("chat.deepResearch.superseded"),
    });
    return;
  }
  if (active.brief) renderBrief(cardEl, active, active.brief, context);
  if (active.pending?.kind === "clarification") return;
  if (active.pending?.kind === "plan" && active.plan) {
    renderPendingPlan(cardEl, active, active.plan, context);
    return;
  }
  if (active.plan) renderPlan(cardEl, active.plan, t);
  if (active.plan?.approvedAt) {
    renderProgress(cardEl, active, active.plan, context);
    return;
  }
  renderActions(cardEl, active, context, [cancelAction(active, t)]);
}

function renderPlan(
  cardEl: HTMLElement,
  plan: ResearchPlan,
  t: Translate,
  renderBranch: (itemEl: HTMLElement, branch: ResearchBranch) => void = renderBranchText,
): void {
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
}

function renderBranchText(itemEl: HTMLElement, branch: ResearchBranch): void {
  itemEl.createDiv({ cls: "attest-research-card__branch-title", text: branch.title });
  itemEl.createDiv({ cls: "attest-research-card__branch-task", text: branch.task });
}

function renderPendingPlan(
  cardEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
): void {
  const bodyEl = cardEl.createDiv({ cls: "attest-research-card__plan" });
  const show = (editing: boolean): void => {
    bodyEl.empty();
    if (editing) {
      renderPlanEditor(bodyEl, state, plan, context, () => show(false));
      return;
    }
    renderPlan(bodyEl, plan, context.t);
    renderPlanControls(bodyEl, state, plan, context, () => show(true));
  };
  show(false);
}

function renderPlanControls(
  parentEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
  onEdit: () => void,
): void {
  const { t } = context;
  const decide = (payload: unknown): ResearchTurnInput => ({
    type: "decision",
    decision: {
      researchId: state.researchId,
      decisionId: state.pending!.decisionId,
      expectedRevision: state.revision,
      payload,
    },
  });
  const actionsEl = renderActions(parentEl, state, context, [
    {
      label: t("chat.deepResearch.action.approve"),
      turnLabel: t("chat.deepResearch.turn.approve"),
      input: decide({ action: "approve" }),
      primary: true,
    },
    {
      label: t("chat.deepResearch.action.regenerate"),
      turnLabel: t("chat.deepResearch.turn.regenerate"),
      input: decide({ action: "regenerate", instruction: null }),
      disabled: !canRegenerate(plan),
    },
    cancelAction(state, t),
  ]);
  if (!context.onEditPlan) return;
  const editButton = actionsEl.createEl("button", {
    cls: "attest-research-card__action",
    text: t("chat.deepResearch.action.edit"),
  });
  editButton.disabled = context.running === true || context.sentTurns.has(turnKey(state));
  editButton.addEventListener("click", () => {
    if (!context.sentTurns.has(turnKey(state))) onEdit();
  });
}

function renderPlanEditor(
  parentEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
  onCancel: () => void,
): void {
  const fields: { branchId: string; enabled: HTMLInputElement; task: HTMLTextAreaElement }[] = [];
  renderPlan(parentEl, plan, context.t, (itemEl, branch) => {
    const labelEl = itemEl.createEl("label", { cls: "attest-research-card__branch-title" });
    const enabled = labelEl.createEl("input", { attr: { type: "checkbox" } });
    enabled.checked = branch.enabled;
    labelEl.appendText(` ${branch.title}`);
    const task = itemEl.createEl("textarea", {
      cls: "attest-research-card__editor-task",
      attr: { maxlength: String(MAX_RESEARCH_TEXT_CHARS) },
    });
    task.value = branch.task;
    fields.push({ branchId: branch.branchId, enabled, task });
  });
  let errorEl: HTMLElement | null = null;
  const actionsEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const save = actionsEl.createEl("button", {
    cls: "attest-research-card__action mod-cta",
    text: context.t("chat.deepResearch.action.save"),
  });
  const cancel = actionsEl.createEl("button", {
    cls: "attest-research-card__action",
    text: context.t("chat.deepResearch.action.cancelEdit"),
  });
  cancel.addEventListener("click", onCancel);
  save.addEventListener("click", () => {
    if (save.disabled || !context.onEditPlan) return;
    save.disabled = true;
    cancel.disabled = true;
    void context
      .onEditPlan({
        researchId: state.researchId,
        decisionId: state.pending!.decisionId,
        expectedRevision: state.revision,
        branches: fields.map((field) => ({
          branchId: field.branchId,
          enabled: field.enabled.checked,
          task: field.task.value,
        })),
      })
      .then((result) => {
        if (result.ok) return;
        if (!errorEl) {
          errorEl = parentEl.createDiv({
            cls: "attest-research-card__notice attest-research-card__notice--error",
          });
          parentEl.insertBefore(errorEl, actionsEl);
        }
        errorEl.setText(context.t("chat.deepResearch.editFailed", { reason: result.message }));
        save.disabled = false;
        cancel.disabled = false;
      });
  });
}

function isReference(value: unknown): value is ResearchArtifactReference {
  if (typeof value !== "object" || value === null) return false;
  const reference = value as Record<string, unknown>;
  return (
    isResearchId(reference.researchId) &&
    reference.artifact === "plan" &&
    isRevision(reference.revision)
  );
}
