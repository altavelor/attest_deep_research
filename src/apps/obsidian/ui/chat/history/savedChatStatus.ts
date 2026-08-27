import { setIcon } from "obsidian";

import type { ChatSessionStatus } from "@core/chat/chatSession";
import { isNonTerminalChatSessionStatus } from "@core/chat/chatSession";
import type { ChatHistoryActivity } from "@core/chat/chatSession";
import type { MessageKey, Translate } from "@adapters/i18n";

export interface SavedChatStatusOptions {
  status: ChatSessionStatus;
  title: string;
  t: Translate;
  onStopChat?(): void;
}

const STATUS_LABEL_KEYS: Record<Exclude<ChatSessionStatus, "idle">, MessageKey> = {
  queued: "chat.session.status.queued",
  running: "chat.session.status.running",
  stopping: "chat.session.status.stopping",
  completed: "chat.session.status.completed",
  failed: "chat.session.status.failed",
  interrupted: "chat.session.status.interrupted",
};

export function savedChatStatusLabel(status: ChatSessionStatus, t: Translate): string {
  return status === "idle" ? "" : t(STATUS_LABEL_KEYS[status]);
}

/**
 * Renders the always-visible status column of a chat row: an animated spinner
 * and a Stop control while the run is non-terminal, a status dot afterwards.
 * The reserved container keeps the row from shifting when controls change.
 */
export function renderSavedChatStatus(
  containerEl: HTMLElement,
  options: SavedChatStatusOptions,
): HTMLElement {
  const status = options.status;
  const statusEl = containerEl.createDiv({
    cls: "attest-chat__session-status",
    attr: { "data-status": status },
  });

  if (status === "idle") {
    return statusEl;
  }

  const label = savedChatStatusLabel(status, options.t);
  const indicator = statusEl.createSpan({
    cls: isNonTerminalChatSessionStatus(status)
      ? "attest-chat-session-spinner"
      : "attest-chat__session-dot",
    attr: {
      role: "img",
      "aria-label": options.t("chat.session.status.aria", { title: options.title, status: label }),
      title: label,
      "data-status": status,
    },
  });
  if (isNonTerminalChatSessionStatus(status)) {
    setIcon(indicator, "loader-circle");
  }

  if (!options.onStopChat || !isNonTerminalChatSessionStatus(status)) {
    return statusEl;
  }

  const stopButton = statusEl.createEl("button", {
    cls: "attest-chat__session-stop",
    attr: {
      type: "button",
      "aria-label": options.t("chat.session.stop.aria", { title: options.title }),
      title: options.t("chat.session.stop"),
    },
  });
  setIcon(stopButton, "square");
  stopButton.disabled = status === "stopping";
  stopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    options.onStopChat?.();
  });

  return statusEl;
}

/**
 * Renders the two independent corner indicators of the Chats history button.
 * The spinner marks running sessions, the dot unread completions; both may show
 * at once and neither moves the button.
 */
export function renderChatHistoryActivity(
  buttonEl: HTMLElement,
  activity: ChatHistoryActivity,
): void {
  buttonEl.toggleClass("has-activity", activity.runningCount > 0);
  buttonEl.toggleClass("has-unread", activity.unreadCompletedCount > 0);
  const indicators = buttonEl.createSpan({ cls: "attest-chat__history-activity" });
  const spinner = indicators.createSpan({
    cls: "attest-chat__history-activity-spinner",
    attr: { "aria-hidden": "true" },
  });
  spinner.toggleClass("is-hidden", activity.runningCount === 0);
  const dot = indicators.createSpan({
    cls: "attest-chat__history-activity-dot",
    attr: { "aria-hidden": "true" },
  });
  dot.toggleClass("is-hidden", activity.unreadCompletedCount === 0);
}

/** Builds the localized accessible name that reports both aggregate counts. */
export function chatHistoryActivityLabel(
  label: string,
  activity: ChatHistoryActivity,
  t: Translate,
): string {
  const parts: string[] = [];
  if (activity.runningCount > 0) {
    parts.push(
      t(
        activity.runningCount === 1
          ? "chat.session.activity.running.one"
          : "chat.session.activity.running.other",
        { count: activity.runningCount },
      ),
    );
  }
  if (activity.unreadCompletedCount > 0) {
    parts.push(
      t(
        activity.unreadCompletedCount === 1
          ? "chat.session.activity.unread.one"
          : "chat.session.activity.unread.other",
        { count: activity.unreadCompletedCount },
      ),
    );
  }
  if (parts.length === 0) return label;
  const details =
    parts.length === 1
      ? parts[0]
      : t("chat.session.activity.join", { first: parts[0], second: parts[1] });
  return t("chat.session.activity.label", { label, details });
}
