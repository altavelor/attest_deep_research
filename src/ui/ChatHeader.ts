import { setIcon } from "obsidian";

export type IxplorerPanel = "chat" | "indexSearch";

export interface ChatHeaderOptions {
  activePanel: IxplorerPanel;
  canSaveAnswer: boolean;
  onPanelChange(panel: IxplorerPanel): void;
  onOpenHistory(anchorEl: HTMLElement): void;
  onNewChat(): void;
  onSaveAnswerToNewNote(): void;
  onAppendAnswerToActiveNote(): void;
}

export function renderPanelTabs(containerEl: HTMLElement, options: ChatHeaderOptions): void {
  const tabs = containerEl.createDiv({ cls: "ixplorer-chat__tabs", attr: { role: "tablist" } });
  createPanelTab(tabs, "chat", "Chat", options);
  createPanelTab(tabs, "indexSearch", "Index search", options);
}

export function renderChatWindowActions(
  containerEl: HTMLElement,
  options: ChatHeaderOptions,
): void {
  const actions = containerEl.createDiv({ cls: "ixplorer-chat__window-actions" });
  const historyButton = createHeaderIconButton(actions, {
    icon: "history",
    label: "Chats history",
    disabled: false,
    onClick: () => options.onOpenHistory(historyButton),
  });
  createHeaderIconButton(actions, {
    icon: "message-square-plus",
    label: "New chat",
    disabled: false,
    onClick: options.onNewChat,
  });
  createHeaderIconButton(actions, {
    icon: "file-plus-2",
    label: "Save answer to new note",
    disabled: !options.canSaveAnswer,
    onClick: options.onSaveAnswerToNewNote,
  });
  createHeaderIconButton(actions, {
    icon: "file-input",
    label: "Append answer to active note",
    disabled: !options.canSaveAnswer,
    onClick: options.onAppendAnswerToActiveNote,
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
