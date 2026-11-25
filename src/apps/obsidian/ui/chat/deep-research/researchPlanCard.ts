import {
  canRegenerate,
  isResearchId,
  isRevision,
  type ResearchArtifactReference,
  type ResearchPlan,
  type ResearchState,
  type ResearchTurnInput,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { renderPlan } from "./researchPlanView";
import { renderPlanEditor } from "./researchPlanEditor";
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

function isReference(value: unknown): value is ResearchArtifactReference {
  if (typeof value !== "object" || value === null) return false;
  const reference = value as Record<string, unknown>;
  return (
    isResearchId(reference.researchId) &&
    reference.artifact === "plan" &&
    isRevision(reference.revision)
  );
}
