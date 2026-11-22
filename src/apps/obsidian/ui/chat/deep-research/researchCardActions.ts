import type { Translate } from "@adapters/i18n";
import type { ResearchState, ResearchTurnInput } from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";

export interface CardAction {
  label: string;
  turnLabel: string;
  input: ResearchTurnInput;
  disabled?: boolean;
  primary?: boolean;
}

/** Builds the action that cancels a research. */
export function cancelAction(state: ResearchState, t: Translate): CardAction {
  return {
    label: t("chat.deepResearch.action.cancel"),
    turnLabel: t("chat.deepResearch.turn.cancel"),
    input: { type: "cancel", researchId: state.researchId },
  };
}

/**
 * Renders a row of card actions that send research turns. A sent turn of a research revision
 * disables every action of that revision, also across rerenders.
 */
export function renderActions(
  parentEl: HTMLElement,
  state: ResearchState,
  context: ResearchCardContext,
  actions: readonly CardAction[],
  lateAction?: () => CardAction,
): HTMLElement {
  const actionsEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const key = turnKey(state);
  const buttons: HTMLButtonElement[] = [];
  const send = (action: CardAction): void => {
    if (context.sentTurns.has(key)) return;
    context.sentTurns.add(key);
    for (const button of buttons) button.disabled = true;
    context.onTurn(action.input, action.turnLabel);
  };
  const add = (label: string, primary: boolean, disabled: boolean, onClick: () => void): void => {
    const button = actionsEl.createEl("button", {
      cls: `attest-research-card__action${primary ? " mod-cta" : ""}`,
      text: label,
    });
    button.disabled = disabled || context.sentTurns.has(key);
    button.addEventListener("click", onClick);
    buttons.push(button);
  };
  for (const action of actions) {
    add(action.label, action.primary === true, action.disabled === true, () => send(action));
  }
  if (lateAction) {
    const preview = lateAction();
    add(preview.label, true, false, () => send(lateAction()));
  }
  return actionsEl;
}

/** Identifies the research revision a card action belongs to. */
export function turnKey(state: ResearchState): string {
  return `${state.researchId}:${state.revision}`;
}
