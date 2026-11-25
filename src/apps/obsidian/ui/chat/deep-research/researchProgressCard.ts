import type { ResearchPlan, ResearchState } from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { cancelAction, renderActions, type CardAction } from "./researchCardActions";
import { renderDiscovery } from "./researchDiscoveryCard";
import { renderBranchProgress } from "./researchBranchProgress";

/**
 * Renders the progress of an approved research: the branch progress block with the spent budget,
 * then the discovery section. A research that executes while no turn runs is paused and offers
 * Continue and Cancel; an old plan waiting on a stale-plan decision offers its three choices.
 */
export function renderProgress(
  cardEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
): void {
  const { t } = context;
  renderBranchProgress(cardEl, state, plan, context);
  if (state.discovery) renderDiscovery(cardEl, state, state.discovery, context);
  if (context.running || state.pending?.kind === "observation") return;
  if (state.pending?.kind === "stale-plan") {
    renderStaleChoices(cardEl, state, context);
    return;
  }
  cardEl.createDiv({ cls: "attest-research-card__notice", text: t("chat.deepResearch.paused") });
  renderActions(cardEl, state, context, [
    {
      label: t("chat.deepResearch.action.continue"),
      turnLabel: t("chat.deepResearch.turn.continue"),
      input: { type: "continue", researchId: state.researchId },
      primary: true,
    },
    cancelAction(state, t),
  ]);
}

function renderStaleChoices(
  cardEl: HTMLElement,
  state: ResearchState,
  context: ResearchCardContext,
): void {
  const { t } = context;
  cardEl.createDiv({ cls: "attest-research-card__notice", text: t("chat.deepResearch.stale") });
  const decide = (action: "continue" | "replan" | "cancel", label: string): CardAction => ({
    label,
    turnLabel: label,
    input: {
      type: "decision",
      decision: {
        researchId: state.researchId,
        decisionId: state.pending!.decisionId,
        expectedRevision: state.revision,
        payload: { action },
      },
    },
    primary: action === "continue",
  });
  renderActions(cardEl, state, context, [
    decide("continue", t("chat.deepResearch.action.continueAnyway")),
    decide("replan", t("chat.deepResearch.action.replan")),
    decide("cancel", t("chat.deepResearch.action.cancel")),
  ]);
}
