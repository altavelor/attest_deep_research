import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import { cleanDisplayText } from "@core/chat/safeInlineMarkup";
import type { ParentTimelineEvent } from "@core/chat/subAgentPlacement";
import type { SubAgentNoticeEntry } from "@core/research";
import { renderFoldedMarkup, renderToggle } from "./safeMarkupView";
import { compactCount, formatElapsed, knownTokenTotal } from "./sub-agents/format";

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
const TONES: Readonly<Record<string, string>> = {
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
  if (event.kind === "agent-notice") return ICONS[event.notice.kind];
  if (event.status !== "running" && event.status !== "queued") return ICONS[event.status];
  return event.created ? ICONS.created : "send";
}

/** Returns the event's kind class suffix: the run status for a dispatch, else the notice kind. */
export function subAgentEventKind(event: ParentTimelineEvent): string {
  return event.kind === "agent-dispatch" ? `dispatch is-${event.status}` : event.notice.kind;
}

/** Renders a dispatch or notice that has no parent message as a standalone transcript node. */
export function renderSubAgentTimelineItem(
  containerEl: HTMLElement,
  event: ParentTimelineEvent,
  options: SubAgentEventRenderOptions,
): void {
  const kind = subAgentEventKind(event);
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
 * Renders one run of a child agent as a single card that updates in place: the agent title,
 * the command kind when it is not the first, the run status and one opener in the head; the
 * run's usage, outcome reason and folded reply below; and the command, folded behind a toggle
 * once a reply exists.
 */
function renderDispatchContent(
  nodeEl: HTMLElement,
  event: Extract<ParentTimelineEvent, { kind: "agent-dispatch" }>,
  options: SubAgentEventRenderOptions,
): void {
  const { t } = options;
  const entry = event.dispatch;
  const outcome = event.outcome;
  const cardEl = nodeEl.createDiv({ cls: "attest-chat__agent-card attest-chat__agent-run" });
  const tone = TONES[event.status];
  if (tone) cardEl.addClass(`is-${tone}`);
  const title =
    cleanDisplayText(event.title) ||
    t(event.created ? "chat.agent.notice.created" : "chat.agent.dispatch.title");
  cardEl.setAttribute("aria-label", title);
  const headEl = cardEl.createDiv({ cls: "attest-chat__agent-card-head" });
  headEl.createSpan({ cls: "attest-chat__agent-run-title", text: title, attr: { title } });
  if (entry.commandKind !== "initial") {
    headEl.createSpan({
      cls: "attest-chat__agent-badge",
      text: t(`chat.agent.command.${entry.commandKind}`),
    });
  }
  if (entry.commandKind === "retry") {
    headEl.createSpan({
      cls: "attest-chat__agent-attempt",
      text: t("chat.agent.attempt", { attempt: String(entry.attempt) }),
    });
  }
  const statusEl = headEl.createSpan({
    cls: `attest-chat__agent-status is-${event.status}`,
    attr: { "data-status": event.status },
  });
  statusEl.createSpan({ cls: "attest-chat__agent-status-dot", attr: { "aria-hidden": "true" } });
  statusEl.createSpan({ text: t(`chat.agent.status.${event.status}`) });
  actions(headEl, entry.sessionId, options, true);
  const meta = outcome ? replyMeta(outcome, t) : "";
  if (meta) cardEl.createDiv({ cls: "attest-chat__agent-reply-meta", text: meta });
  const body = outcome
    ? noticeBody(outcome, t)
    : event.status === "queued"
      ? t("chat.agent.notice.queued.body")
      : null;
  if (body) cardEl.createDiv({ cls: "attest-chat__agent-event-body", text: body });
  if (outcome?.replyExcerpt) {
    renderFoldedMarkup(
      cardEl,
      outcome.replyExcerpt,
      PREVIEW_CHARS,
      t("chat.agent.showFullReply"),
      t,
    );
    const commandEl = cardEl.createDiv({ cls: "attest-chat__agent-command" });
    commandEl.hidden = true;
    commandEl.createDiv({ cls: "attest-chat__agent-text", text: entry.body });
    renderToggle(cardEl, t("chat.agent.showTask"), t, (expanded) => {
      commandEl.hidden = !expanded;
    });
    cardEl.appendChild(commandEl);
    return;
  }
  foldedText(
    cardEl.createDiv({ cls: "attest-chat__agent-command" }),
    entry.body,
    t("chat.agent.showFullCommand"),
    t,
  );
}

function isCount(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0;
}

function titleLine(parentEl: HTMLElement, label: string, rawTitle: string): void {
  const title = cleanDisplayText(rawTitle);
  const lineEl = parentEl.createDiv({ cls: "attest-chat__agent-event-line" });
  lineEl.createSpan({ cls: "attest-chat__agent-event-title", text: label });
  lineEl.createSpan({
    cls: "attest-chat__agent-event-description",
    text: title,
    attr: { title },
  });
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
    titleLine(nodeEl, t(`chat.agent.notice.${entry.kind}`), entry.description);
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
  const agentTitle = cleanDisplayText(entry.description);
  if (agentTitle) cardEl.setAttribute("aria-label", agentTitle);
  const tone = TONES[entry.kind];
  if (tone) cardEl.addClass(`is-${tone}`);
  cardEl.createDiv({ cls: "attest-chat__agent-card-head", text: noticeTitle(entry, t) });
  const body = noticeBody(entry, t);
  if (body) cardEl.createDiv({ cls: "attest-chat__agent-event-body", text: body });
  if (entry.replyExcerpt) {
    renderFoldedMarkup(cardEl, entry.replyExcerpt, PREVIEW_CHARS, t("chat.agent.showFullReply"), t);
  }
  const footEl = cardEl.createDiv({ cls: "attest-chat__agent-card-foot" });
  const meta = replyMeta(entry, t);
  if (meta) footEl.createSpan({ cls: "attest-chat__agent-reply-meta", text: meta });
  actions(footEl, entry.sessionId, options);
}

function replyMeta(entry: SubAgentNoticeEntry, t: Translate): string {
  const parts: string[] = [];
  const usage = entry.usage?.source === "unavailable" ? undefined : entry.usage;
  if (isCount(entry.durationMs)) parts.push(formatElapsed(entry.durationMs, t));
  if (isCount(usage?.toolCalls)) {
    parts.push(t("chat.agent.meta.toolCalls", { count: String(usage.toolCalls) }));
  }
  const tokens = usage ? (knownTokenTotal(usage) ?? undefined) : undefined;
  if (isCount(tokens)) parts.push(t("chat.subAgents.tokens", { count: compactCount(tokens) }));
  const model = cleanDisplayText(entry.modelLabel ?? "");
  if (model) parts.push(model);
  return parts.join(" · ");
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
  renderToggle(parentEl, expandLabel, t, (expanded) => {
    textEl.setText(expanded ? text : preview(text));
  });
}

function preview(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
}

function actions(
  parentEl: HTMLElement,
  sessionId: string | null,
  options: SubAgentEventRenderOptions,
  iconOnly = false,
): void {
  const open = options.onOpenSubAgentSession;
  if (!open || sessionId === null) return;
  const label = options.t("chat.agent.openDetails");
  const button = parentEl.createEl("button", {
    cls: `attest-chat__agent-open${iconOnly ? " clickable-icon" : ""}`,
    attr: { type: "button", ...(iconOnly ? { "aria-label": label, title: label } : {}) },
  });
  if (iconOnly) setIcon(button, "external-link");
  else button.setText(label);
  button.addEventListener("click", () => open(sessionId));
}
