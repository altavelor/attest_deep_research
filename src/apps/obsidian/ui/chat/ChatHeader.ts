import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { ChatHistoryActivity } from "@core/chat/chatSession";
import { chatHistoryActivityLabel, renderChatHistoryActivity } from "./history/savedChatStatus";

export type AttestPanel = "chat" | "indexSearch";

export interface ChatHeaderOptions {
  activePanel: AttestPanel;
  hasCompletedAnswer: boolean;
  isDebugMode: boolean;
  historyActivity: ChatHistoryActivity;
  t: Translate;
  onPanelChange(panel: AttestPanel): void;
  onOpenHistory(anchorEl: HTMLElement): void;
  onOpenSources(): void;
  onNewChat(): void;
}

export function renderPanelTabs(containerEl: HTMLElement, options: ChatHeaderOptions): void {
  if (!options.isDebugMode) {
    return;
  }

  const tabs = containerEl.createDiv({ cls: "attest-chat__tabs", attr: { role: "tablist" } });
  createPanelTab(tabs, "chat", options.t("chat.tab.chat"), options);
  createPanelTab(tabs, "indexSearch", options.t("chat.tab.indexSearch"), options);
}

export function renderChatWindowActions(
  containerEl: HTMLElement,
  options: ChatHeaderOptions,
): void {
  const actions = containerEl.createDiv({ cls: "attest-chat__window-actions" });
  const historyButton = createHeaderIconButton(actions, {
    icon: "history",
    label: chatHistoryActivityLabel(
      options.t("chat.action.history"),
      options.historyActivity,
      options.t,
    ),
    disabled: false,
    onClick: () => options.onOpenHistory(historyButton),
  });
  renderChatHistoryActivity(historyButton, options.historyActivity);
  if (options.hasCompletedAnswer) {
    createHeaderIconButton(actions, {
      icon: "book-open",
      label: options.t("chat.action.sources"),
      disabled: false,
      onClick: options.onOpenSources,
    });
  }
  createHeaderIconButton(actions, {
    icon: "message-square-plus",
    label: options.t("chat.action.newChat"),
    disabled: false,
    onClick: options.onNewChat,
  });
}

function createPanelTab(
  containerEl: HTMLElement,
  panel: AttestPanel,
  label: string,
  options: ChatHeaderOptions,
): void {
  const button = containerEl.createEl("button", {
    cls: `attest-chat__tab${options.activePanel === panel ? " is-active" : ""}`,
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
    cls: "attest-chat__icon-button",
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
