import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";

export interface SubAgentsButton {
  buttonEl: HTMLButtonElement;
  updateCount(count: number): void;
}

/**
 * Creates the detached composer pill that opens the sub-agent sessions. Its own class
 * never depends on the count; only the inner content element switches to the active tone.
 */
export function createSubAgentsButton(
  doc: Document,
  t: Translate,
  onOpen: () => void,
): SubAgentsButton {
  const buttonEl = doc.createElement("button");
  buttonEl.className = "attest-chat__agents-button";
  buttonEl.type = "button";
  const contentEl = buttonEl.createSpan({ cls: "attest-chat__agents-button-content" });
  setIcon(contentEl.createSpan({ cls: "attest-chat__agents-button-icon" }), "bot");
  const countEl = contentEl.createSpan({
    cls: "attest-chat__agents-button-count",
    attr: { "aria-live": "polite" },
  });
  buttonEl.addEventListener("click", () => onOpen());

  const updateCount = (count: number): void => {
    const text = String(count);
    if (countEl.textContent !== text) countEl.setText(text);
    contentEl.toggleClass("is-active", count > 0);
    buttonEl.setAttr("aria-label", t("chat.subAgents.button.aria", { count: text }));
    buttonEl.setAttr("title", t("chat.subAgents.button.tooltip", { count: text }));
  };
  updateCount(0);
  return { buttonEl, updateCount };
}
