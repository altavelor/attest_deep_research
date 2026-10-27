import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { ChatTimelineItem } from "@core/chat/subAgentTimeline";
import type { SubAgentDispatchEntry, SubAgentNoticeEntry } from "@core/research";

export interface SubAgentEventRenderOptions {
  t: Translate;
  onOpenSubAgentSession?: (sessionId: string) => void;
}

const PREVIEW_CHARS = 280;
const ICONS: Record<SubAgentNoticeEntry["kind"], string> = {
  created: "bot",
  queued: "bot",
  finished: "check",
  partial: "alert-triangle",
  failed: "x",
  stopped: "x",
  interrupted: "x",
  "import-failed": "alert-triangle",
  "not-started": "alert-triangle",
  closed: "x",
  batch: "layers",
};
const TONES: Partial<Record<SubAgentNoticeEntry["kind"], string>> = {
  finished: "success",
  partial: "partial",
  failed: "error",
  "import-failed": "error",
  stopped: "warning",
  interrupted: "warning",
  "not-started": "warning",
};

/**
 * Renders one outgoing command to a child agent as safe text: its kind, attempt and
 * body, folded to a preview with the full command one click away. Child text is never
 * parsed as Markdown or HTML, so links and markup in it stay inert.
 */
/** Builds the event render options, adding the session opener only when the host has one. */
export function subAgentEventOptions(
  t: Translate,
  onOpenSubAgentSession?: (sessionId: string) => void,
): SubAgentEventRenderOptions {
  return { t, ...(onOpenSubAgentSession ? { onOpenSubAgentSession } : {}) };
}

/** Renders a dispatch or notice item of the chat timeline. */
export function renderSubAgentTimelineItem(
  containerEl: HTMLElement,
  item: Exclude<ChatTimelineItem, { kind: "message" }>,
  options: SubAgentEventRenderOptions,
): void {
  if (item.kind === "agent-dispatch") renderSubAgentDispatch(containerEl, item.dispatch, options);
  else renderSubAgentNotice(containerEl, item.notice, options);
}

export function renderSubAgentDispatch(
  parentEl: HTMLElement,
  entry: SubAgentDispatchEntry,
  options: SubAgentEventRenderOptions,
): void {
  const { t } = options;
  const nodeEl = eventNode(parentEl, "send", "dispatch", entry.eventKey);
  nodeEl.createDiv({ cls: "attest-chat__agent-event-label", text: t("chat.agent.dispatch.title") });
  const cardEl = nodeEl.createDiv({ cls: "attest-chat__agent-card" });
  const headEl = cardEl.createDiv({ cls: "attest-chat__agent-card-head" });
  headEl.createSpan({
    cls: "attest-chat__agent-badge",
    text: t(`chat.agent.command.${entry.commandKind}`),
  });
  if (entry.commandKind === "retry") {
    headEl.createSpan({
      cls: "attest-chat__agent-attempt",
      text: t("chat.agent.attempt", { attempt: String(entry.attempt) }),
    });
  }
  foldedText(cardEl, entry.body, t("chat.agent.showFullCommand"), t);
  actions(cardEl, entry.sessionId, options);
}

/** Renders one lifecycle notice of a child agent as a timeline node in the parent transcript. */
export function renderSubAgentNotice(
  parentEl: HTMLElement,
  entry: SubAgentNoticeEntry,
  options: SubAgentEventRenderOptions,
): void {
  const { t } = options;
  const nodeEl = eventNode(parentEl, ICONS[entry.kind], entry.kind, entry.eventKey);
  if (entry.kind === "closed") {
    nodeEl.addClass("is-muted");
    nodeEl.createDiv({
      cls: "attest-chat__agent-event-label",
      text: t("chat.agent.notice.closed", { count: String(entry.closedCount ?? 0) }),
    });
    return;
  }
  if (entry.kind === "created" || entry.kind === "queued") {
    const lineEl = nodeEl.createDiv({ cls: "attest-chat__agent-event-line" });
    lineEl.createSpan({
      cls: "attest-chat__agent-event-title",
      text: t(`chat.agent.notice.${entry.kind}`),
    });
    lineEl.createSpan({ cls: "attest-chat__agent-event-description", text: entry.description });
    if (entry.kind === "queued") {
      nodeEl.createDiv({
        cls: "attest-chat__agent-event-body",
        text: t("chat.agent.notice.queued.body"),
      });
    }
    actions(nodeEl, entry.sessionId, options);
    return;
  }
  const cardEl = nodeEl.createDiv({ cls: "attest-chat__agent-card" });
  const tone = TONES[entry.kind];
  if (tone) cardEl.addClass(`is-${tone}`);
  cardEl.createDiv({ cls: "attest-chat__agent-card-head", text: noticeTitle(entry, t) });
  if (entry.description) {
    cardEl.createDiv({ cls: "attest-chat__agent-event-description", text: entry.description });
  }
  const body = noticeBody(entry, t);
  if (body) cardEl.createDiv({ cls: "attest-chat__agent-event-body", text: body });
  if (entry.replyExcerpt) {
    foldedText(cardEl, entry.replyExcerpt, t("chat.agent.showFullReply"), t);
  }
  actions(cardEl, entry.sessionId, options);
}

function eventNode(
  parentEl: HTMLElement,
  icon: string,
  kind: string,
  eventKey: string,
): HTMLElement {
  const nodeEl = parentEl.createDiv({
    cls: `attest-chat__agent-event attest-chat__agent-event--${kind}`,
    attr: { "data-event-key": eventKey },
  });
  const markEl = nodeEl.createSpan({
    cls: "attest-chat__agent-event-mark",
    attr: { "aria-hidden": "true", "data-icon": icon },
  });
  setIcon(markEl, icon);
  return nodeEl;
}

function noticeTitle(entry: SubAgentNoticeEntry, t: Translate): string {
  if (entry.kind === "batch") {
    return t("chat.agent.notice.batch", { total: String(entry.batch?.total ?? 0) });
  }
  return t(`chat.agent.notice.${entry.kind}`);
}

function noticeBody(entry: SubAgentNoticeEntry, t: Translate): string | null {
  const reason = entry.reasonCode ?? "unknown";
  switch (entry.kind) {
    case "partial":
      return t("chat.agent.notice.partial.body");
    case "failed":
      return t("chat.agent.notice.failed.body", { reason });
    case "stopped":
      return t("chat.agent.notice.stopped.body");
    case "import-failed":
      return t("chat.agent.notice.import-failed.body");
    case "not-started":
      return t("chat.agent.notice.not-started.body", { reason });
    case "interrupted":
      return t(interruptedKey(reason));
    case "batch":
      return entry.batch
        ? t("chat.agent.notice.batch.body", {
            done: String(entry.batch.done),
            running: String(entry.batch.running),
            failed: String(entry.batch.failed),
          })
        : null;
    default:
      return null;
  }
}

function interruptedKey(reason: string): Parameters<Translate>[0] {
  if (reason === "plugin-unload" || reason === "crash-recovery") {
    return "chat.agent.notice.interrupted.reload";
  }
  if (reason === "timeout" || reason === "deadline" || reason === "finalize-timeout") {
    return "chat.agent.notice.interrupted.timeout";
  }
  return "chat.agent.notice.interrupted.stopped";
}

function foldedText(parentEl: HTMLElement, text: string, expandLabel: string, t: Translate): void {
  const textEl = parentEl.createDiv({ cls: "attest-chat__agent-text", text: preview(text) });
  if (text.length <= PREVIEW_CHARS) return;
  const toggle = parentEl.createEl("button", {
    cls: "attest-chat__agent-toggle",
    text: expandLabel,
    attr: { type: "button", "aria-expanded": "false" },
  });
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    textEl.setText(expanded ? text : preview(text));
    toggle.setText(expanded ? t("chat.agent.showLess") : expandLabel);
    toggle.setAttribute("aria-expanded", String(expanded));
  });
}

function preview(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
}

function actions(
  parentEl: HTMLElement,
  sessionId: string | null,
  options: SubAgentEventRenderOptions,
): void {
  const open = options.onOpenSubAgentSession;
  if (!open || sessionId === null) return;
  const button = parentEl.createEl("button", {
    cls: "attest-chat__agent-open",
    text: options.t("chat.agent.openDetails"),
    attr: { type: "button" },
  });
  button.addEventListener("click", () => open(sessionId));
}
