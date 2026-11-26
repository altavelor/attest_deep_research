import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import { cleanDisplayText } from "@core/chat/safeInlineMarkup";
import type { ParentTimelineEvent, SubAgentRunStatus } from "@core/chat/subAgentPlacement";
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
const RUN_ICONS: Record<SubAgentRunStatus, string> = {
  running: "loader",
  queued: "clock",
  finished: "check-circle",
  partial: "alert-circle",
  failed: "x-circle",
  stopped: "x-circle",
  interrupted: "alert-circle",
  "import-failed": "alert-circle",
  "not-started": "alert-circle",
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
  return ICONS.created;
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

interface RunCardHead {
  status: string;
  icon: string;
  title: string;
  meta: string;
  chip: string | null;
  badges: readonly string[];
  sessionId: string | null;
}

/**
 * Renders the shared agent card: a head with the status icon, the title over its usage line,
 * badges, the status chip and one opener, and an empty body that the caller fills and that
 * hides itself while empty.
 */
function renderRunCard(
  nodeEl: HTMLElement,
  head: RunCardHead,
  options: SubAgentEventRenderOptions,
): HTMLElement {
  const cardEl = nodeEl.createDiv({
    cls: `attest-chat__agent-card attest-chat__agent-run is-${head.status}`,
    attr: { "aria-label": head.title },
  });
  const headEl = cardEl.createDiv({ cls: "attest-chat__agent-card-head" });
  setIcon(
    headEl.createSpan({
      cls: "attest-chat__agent-run-icon",
      attr: { "aria-hidden": "true", "data-icon": head.icon },
    }),
    head.icon,
  );
  const headingEl = headEl.createDiv({ cls: "attest-chat__agent-run-heading" });
  headingEl.createDiv({
    cls: "attest-chat__agent-run-title",
    text: head.title,
    attr: { title: head.title },
  });
  if (head.meta) headingEl.createDiv({ cls: "attest-chat__agent-reply-meta", text: head.meta });
  for (const badge of head.badges)
    headEl.createSpan({ cls: "attest-chat__agent-badge", text: badge });
  if (head.chip) {
    headEl.createSpan({
      cls: `attest-chat__agent-status is-${head.status}`,
      text: head.chip,
      attr: { "data-status": head.status },
    });
  }
  actions(headEl, head.sessionId, options, true);
  return cardEl.createDiv({ cls: "attest-chat__agent-run-body" });
}

/**
 * Renders one run of a child agent as a single card that updates in place: its title, usage,
 * command kind and status in the head; the outcome reason, the folded reply and the command,
 * quoted and folded behind a toggle once a reply exists, in the body.
 */
function renderDispatchContent(
  nodeEl: HTMLElement,
  event: Extract<ParentTimelineEvent, { kind: "agent-dispatch" }>,
  options: SubAgentEventRenderOptions,
): void {
  const { t } = options;
  const entry = event.dispatch;
  const outcome = event.outcome;
  const badges =
    entry.commandKind === "initial" ? [] : [t(`chat.agent.command.${entry.commandKind}`)];
  if (entry.commandKind === "retry") {
    badges.push(t("chat.agent.attempt", { attempt: String(entry.attempt) }));
  }
  const bodyEl = renderRunCard(
    nodeEl,
    {
      status: event.status,
      icon: RUN_ICONS[event.status],
      title:
        cleanDisplayText(event.title) ||
        t(event.created ? "chat.agent.notice.created" : "chat.agent.dispatch.title"),
      meta: outcome ? replyMeta(outcome, t) : "",
      chip: t(`chat.agent.status.${event.status}`),
      badges,
      sessionId: entry.sessionId,
    },
    options,
  );
  const reason = outcome
    ? noticeBody(outcome, t)
    : event.status === "queued"
      ? t("chat.agent.notice.queued.body")
      : null;
  if (reason) bodyEl.createDiv({ cls: "attest-chat__agent-event-body", text: reason });
  if (!outcome?.replyExcerpt) {
    if (event.status === "queued") return;
    foldedText(
      bodyEl.createDiv({ cls: "attest-chat__agent-command" }),
      entry.body,
      t("chat.agent.showFullCommand"),
      t,
    );
    return;
  }
  renderReply(bodyEl, outcome.replyExcerpt, t);
  const linksEl = bodyEl.lastElementChild as HTMLElement;
  const commandEl = bodyEl.createDiv({ cls: "attest-chat__agent-command" });
  commandEl.hidden = true;
  commandEl.createDiv({ cls: "attest-chat__agent-text", text: entry.body });
  renderToggle(linksEl, t("chat.agent.showTask"), t, (expanded) => {
    commandEl.hidden = !expanded;
  });
}

/** Renders a folded reply followed by a row that holds its toggle and any further toggles. */
function renderReply(bodyEl: HTMLElement, reply: string, t: Translate): void {
  renderFoldedMarkup(bodyEl, reply, PREVIEW_CHARS, t("chat.agent.showFullReply"), t);
  const replyToggle = bodyEl.querySelector(":scope > .attest-chat__agent-toggle");
  const linksEl = bodyEl.createDiv({ cls: "attest-chat__agent-run-links" });
  if (replyToggle) linksEl.appendChild(replyToggle);
}

function isCount(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0;
}

function titleLine(parentEl: HTMLElement, label: string, rawTitle: string): HTMLElement {
  const title = cleanDisplayText(rawTitle);
  const lineEl = parentEl.createDiv({ cls: "attest-chat__agent-event-line" });
  lineEl.createSpan({ cls: "attest-chat__agent-event-title", text: label });
  lineEl.createSpan({
    cls: "attest-chat__agent-event-description",
    text: title,
    attr: { title },
  });
  return lineEl;
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
    const lineEl = titleLine(nodeEl, t(`chat.agent.notice.${entry.kind}`), entry.description);
    if (entry.kind === "queued") {
      nodeEl.createDiv({
        cls: "attest-chat__agent-event-body",
        text: t("chat.agent.notice.queued.body"),
      });
    }
    actions(lineEl, entry.sessionId, options, true);
    return;
  }
  const terminal = entry.kind !== "batch";
  const bodyEl = renderRunCard(
    nodeEl,
    {
      status: entry.kind,
      icon: terminal ? RUN_ICONS[entry.kind as SubAgentRunStatus] : ICONS.batch,
      title: (terminal && cleanDisplayText(entry.description)) || noticeTitle(entry, t),
      meta: terminal ? replyMeta(entry, t) : (noticeBody(entry, t) ?? ""),
      chip: terminal ? t(`chat.agent.status.${entry.kind as SubAgentRunStatus}`) : null,
      badges: [],
      sessionId: entry.sessionId,
    },
    options,
  );
  if (!terminal) return;
  const reason = noticeBody(entry, t);
  if (reason) bodyEl.createDiv({ cls: "attest-chat__agent-event-body", text: reason });
  if (entry.replyExcerpt) renderReply(bodyEl, entry.replyExcerpt, t);
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
