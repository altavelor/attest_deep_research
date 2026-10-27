import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { ParentTimelineEvent } from "@core/chat/subAgentPlacement";
import type { SubAgentNoticeEntry } from "@core/research";

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

/** Builds the event render options, adding the session opener only when the host has one. */
export function subAgentEventOptions(
  t: Translate,
  onOpenSubAgentSession?: (sessionId: string) => void,
): SubAgentEventRenderOptions {
  return { t, ...(onOpenSubAgentSession ? { onOpenSubAgentSession } : {}) };
}

/** Returns the icon that marks a dispatch or notice event on the timeline rail. */
export function subAgentEventIcon(event: ParentTimelineEvent): string {
  return event.kind === "agent-dispatch" ? "send" : ICONS[event.notice.kind];
}

/** Renders a dispatch or notice that has no parent message as a standalone transcript node. */
export function renderSubAgentTimelineItem(
  containerEl: HTMLElement,
  event: ParentTimelineEvent,
  options: SubAgentEventRenderOptions,
): void {
  const kind = event.kind === "agent-dispatch" ? "dispatch" : event.notice.kind;
  const key = event.kind === "agent-dispatch" ? event.dispatch.eventKey : event.notice.eventKey;
  const nodeEl = containerEl.createDiv({
    cls: `attest-chat__agent-event attest-chat__agent-event--${kind}`,
    attr: { "data-event-key": key },
  });
  const icon = subAgentEventIcon(event);
  setIcon(
    nodeEl.createSpan({
      cls: "attest-chat__agent-event-mark",
      attr: { "aria-hidden": "true", "data-icon": icon },
    }),
    icon,
  );
  renderSubAgentEventContent(nodeEl, event, options);
}

/** Fills a timeline node with the label and card of one dispatch or notice. */
export function renderSubAgentEventContent(
  nodeEl: HTMLElement,
  event: ParentTimelineEvent,
  options: SubAgentEventRenderOptions,
): void {
  if (event.kind === "agent-dispatch") renderDispatchContent(nodeEl, event, options);
  else renderNoticeContent(nodeEl, event.notice, options);
}

/**
 * Renders one outgoing command to a child agent as safe text: its title, kind, body
 * folded to a preview and the live run status. Child text is never parsed as Markdown
 * or HTML, so links and markup in it stay inert.
 */
function renderDispatchContent(
  nodeEl: HTMLElement,
  event: Extract<ParentTimelineEvent, { kind: "agent-dispatch" }>,
  options: SubAgentEventRenderOptions,
): void {
  const { t } = options;
  const entry = event.dispatch;
  nodeEl.createDiv({ cls: "attest-chat__agent-event-label", text: t("chat.agent.dispatch.title") });
  const cardEl = nodeEl.createDiv({ cls: "attest-chat__agent-card" });
  const headEl = cardEl.createDiv({ cls: "attest-chat__agent-card-head" });
  headEl.createSpan({ cls: "attest-chat__agent-card-title", text: event.title });
  const tagsEl = headEl.createSpan({ cls: "attest-chat__agent-card-tags" });
  tagsEl.createSpan({
    cls: "attest-chat__agent-badge",
    text: t(`chat.agent.command.${entry.commandKind}`),
  });
  if (entry.commandKind === "retry") {
    tagsEl.createSpan({
      cls: "attest-chat__agent-attempt",
      text: t("chat.agent.attempt", { attempt: String(entry.attempt) }),
    });
  }
  foldedText(
    cardEl.createDiv({ cls: "attest-chat__agent-command" }),
    entry.body,
    t("chat.agent.showFullCommand"),
    t,
  );
  const footEl = cardEl.createDiv({ cls: "attest-chat__agent-card-foot" });
  const statusEl = footEl.createSpan({
    cls: `attest-chat__agent-status is-${event.status}`,
    attr: { "data-status": event.status },
  });
  statusEl.createSpan({ cls: "attest-chat__agent-status-dot", attr: { "aria-hidden": "true" } });
  statusEl.createSpan({ text: t(`chat.agent.status.${event.status}`) });
  actions(footEl, entry.sessionId, options);
}

function renderNoticeContent(
  nodeEl: HTMLElement,
  entry: SubAgentNoticeEntry,
  options: SubAgentEventRenderOptions,
): void {
  const { t } = options;
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
