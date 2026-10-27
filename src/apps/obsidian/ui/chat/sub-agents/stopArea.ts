import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { SubAgentSessionCard } from "@application/contracts/subAgentInspection";
import type { SubAgentRunSummary } from "@core/research";

export type StopState =
  { phase: "idle" } | { phase: "pending" } | { phase: "failed" } | { phase: "stale" };

/**
 * Renders the stop control under the sections: the warning button with its explanation,
 * the waiting state while a stop is saved, the stale and failure notes, or the reason a
 * session cannot be stopped.
 */
export function renderStopArea(
  containerEl: HTMLElement,
  card: SubAgentSessionCard,
  runs: readonly SubAgentRunSummary[],
  stop: StopState,
  t: Translate,
  onStop: () => void,
): void {
  containerEl.empty();
  if (stop.phase === "pending") {
    const button = stopButton(containerEl, t("chat.subAgents.stopping"), "loader", onStop);
    button.setAttr("aria-disabled", "true");
    button.setAttr("aria-busy", "true");
    containerEl.createDiv({
      cls: "attest-sub-agents__stop-hint",
      text: t("chat.subAgents.stopping.hint"),
      attr: { role: "status" },
    });
    return;
  }
  if (stop.phase === "failed") {
    containerEl.createDiv({
      cls: "attest-sub-agents__stop-error",
      text: t("chat.subAgents.stop.failed"),
      attr: { role: "alert" },
    });
    if (card.canStop) stopButton(containerEl, t("chat.subAgents.stop.retry"), "rotate-ccw", onStop);
    return;
  }
  if (!card.canStop) {
    containerEl.createDiv({
      cls: "attest-sub-agents__stop-hint",
      text: t("chat.subAgents.stop.unavailable"),
    });
    return;
  }
  if (stop.phase === "stale") {
    const runIndex = runs.findIndex((run) => run.subAgentRunId === card.controlRunId);
    containerEl.createDiv({
      cls: "attest-sub-agents__stop-warning",
      text: t("chat.subAgents.stop.stale", { run: runIndex + 1 }),
      attr: { role: "status" },
    });
  }
  stopButton(containerEl, t("chat.subAgents.stop"), "square", onStop);
  containerEl.createDiv({
    cls: "attest-sub-agents__stop-hint",
    text: t("chat.subAgents.stop.hint"),
  });
}

function stopButton(
  containerEl: HTMLElement,
  label: string,
  icon: string,
  onStop: () => void,
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: "mod-warning attest-sub-agents__stop-button",
    attr: { type: "button" },
  });
  setIcon(button.createSpan({ cls: "attest-sub-agents__stop-icon" }), icon);
  button.createSpan({ text: label });
  button.addEventListener("click", () => onStop());
  return button;
}
