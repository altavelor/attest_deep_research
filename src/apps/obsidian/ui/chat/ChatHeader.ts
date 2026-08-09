import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";

export type IxplorerPanel = "chat" | "indexSearch";

export interface ChatHeaderOptions {
  activePanel: IxplorerPanel;
  isDebugMode: boolean;
  t: Translate;
  onPanelChange(panel: IxplorerPanel): void;
  onOpenHistory(anchorEl: HTMLElement): void;
  onNewChat(): void;
}

export function renderPanelTabs(containerEl: HTMLElement, options: ChatHeaderOptions): void {
  if (!options.isDebugMode) {
    return;
  }

  const tabs = containerEl.createDiv({ cls: "ixplorer-chat__tabs", attr: { role: "tablist" } });
  createPanelTab(tabs, "chat", options.t("chat.tab.chat"), options);
  createPanelTab(tabs, "indexSearch", options.t("chat.tab.indexSearch"), options);
}

export function renderChatWindowActions(
  containerEl: HTMLElement,
  options: ChatHeaderOptions,
): void {
  const actions = containerEl.createDiv({ cls: "ixplorer-chat__window-actions" });
  const historyButton = createHeaderIconButton(actions, {
    icon: "history",
    label: options.t("chat.action.history"),
    disabled: false,
    onClick: () => options.onOpenHistory(historyButton),
  });
  createHeaderIconButton(actions, {
    icon: "message-square-plus",
    label: options.t("chat.action.newChat"),
    disabled: false,
    onClick: options.onNewChat,
  });
}

function createPanelTab(
  containerEl: HTMLElement,
  panel: IxplorerPanel,
  label: string,
  options: ChatHeaderOptions,
): void {
  const button = containerEl.createEl("button", {
    cls: `ixplorer-chat__tab${options.activePanel === panel ? " is-active" : ""}`,
    text: label,
    attr: {
      type: "button",
      role: "tab",
      "aria-selected": String(options.activePanel === panel),
    },
  });
  button.addEventListener("click", () => options.onPanelChange(panel));
}

function createHeaderIconButton(
  containerEl: HTMLElement,
  options: {
    icon: string;
    label: string;
    disabled: boolean;
    onClick: () => void;
  },
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: "ixplorer-chat__icon-button",
    attr: {
      type: "button",
      "aria-label": options.label,
      title: options.label,
    },
  });
  button.disabled = options.disabled;
  setIcon(button, options.icon);
  button.addEventListener("click", options.onClick);
  return button;
}
