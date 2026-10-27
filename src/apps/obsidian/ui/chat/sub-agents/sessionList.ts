import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type {
  SubAgentInspectionSnapshot,
  SubAgentSessionCard,
} from "@application/contracts/subAgentInspection";
import { formatElapsed, formatTokens, modelLabel, statusLabel, statusTone } from "./format";

export const SESSION_PAGE_SIZE = 50;

export interface SessionListInput {
  snapshot: SubAgentInspectionSnapshot;
  chatTitle: string;
  limit: number;
  t: Translate;
  elapsedOf(card: SubAgentSessionCard): number;
  onSelect(sessionId: string): void;
  onShowMore(): void;
}

export interface RenderedSessionList {
  headingEl: HTMLElement;
  cards: Map<string, HTMLButtonElement>;
  elapsed: Map<string, { card: SubAgentSessionCard; el: HTMLElement }>;
}

/** Renders the session groups of one snapshot: running first, then a paged queued-and-history group. */
export function renderSessionList(
  containerEl: HTMLElement,
  input: SessionListInput,
): RenderedSessionList {
  const { snapshot, t } = input;
  const running = snapshot.sessions.filter((card) => card.status === "running");
  const history = snapshot.sessions.filter((card) => card.status !== "running");
  const headingEl = containerEl.createDiv({
    cls: "attest-sub-agents__subtitle",
    attr: { tabindex: "-1" },
  });
  headingEl.setText(
    [
      input.chatTitle,
      t("chat.subAgents.subtitle", {
        running: snapshot.activeCount,
        total: snapshot.sessions.length,
      }),
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const rendered: RenderedSessionList = { headingEl, cards: new Map(), elapsed: new Map() };
  if (snapshot.sessions.length === 0) {
    renderEmptyState(containerEl, t("chat.subAgents.empty.body"), t);
    return rendered;
  }
  if (running.length > 0) {
    renderGroup(containerEl, t("chat.subAgents.group.running", { count: running.length }));
    running.forEach((card) => renderCard(containerEl, card, input, rendered));
  }
  const historyShown = history.slice(0, Math.max(0, input.limit - running.length));
  if (history.length > 0) {
    renderGroup(containerEl, t("chat.subAgents.group.history", { count: history.length }));
    historyShown.forEach((card) => renderCard(containerEl, card, input, rendered));
  }
  const hidden = history.length - historyShown.length;
  if (hidden > 0) {
    const more = containerEl.createEl("button", {
      cls: "attest-sub-agents__more",
      text: t("chat.subAgents.showMore", { count: hidden }),
      attr: { type: "button" },
    });
    more.addEventListener("click", () => input.onShowMore());
  }
  return rendered;
}

/** Renders the dashed empty state with the agent icon and an explanation. */
export function renderEmptyState(containerEl: HTMLElement, body: string, t: Translate): void {
  const emptyEl = containerEl.createDiv({ cls: "attest-sub-agents__empty" });
  setIcon(emptyEl.createSpan({ cls: "attest-sub-agents__empty-icon" }), "bot");
  emptyEl.createDiv({
    cls: "attest-sub-agents__empty-title",
    text: t("chat.subAgents.empty.title"),
  });
  emptyEl.createDiv({ cls: "attest-sub-agents__empty-body", text: body });
}

function renderGroup(containerEl: HTMLElement, label: string): void {
  containerEl.createDiv({ cls: "attest-sub-agents__group", text: label });
}

function renderCard(
  containerEl: HTMLElement,
  card: SubAgentSessionCard,
  input: SessionListInput,
  rendered: RenderedSessionList,
): void {
  const { t } = input;
  const tokens = formatTokens(card, t);
  const status = statusLabel(card.status, t);
  const model = modelLabel(card.model, t);
  const elapsed = formatElapsed(input.elapsedOf(card), t);
  const button = containerEl.createEl("button", {
    cls: `attest-sub-agents__card attest-sub-agents__card--${statusTone(card.status)}`,
    attr: { type: "button", "data-session-id": card.sessionId },
  });
  button.setAttr(
    "aria-label",
    t("chat.subAgents.card.aria", {
      description: card.description,
      status,
      elapsed,
      model,
      tokens: tokens.text,
    }),
  );
  const body = button.createDiv({ cls: "attest-sub-agents__card-body" });
  body.createDiv({
    cls: "attest-sub-agents__card-description",
    text: card.description,
    attr: { title: card.description },
  });
  const metrics = body.createDiv({ cls: "attest-sub-agents__card-metrics" });
  renderStatus(metrics, card, status);
  const elapsedEl = metrics.createSpan({ cls: "attest-sub-agents__card-elapsed", text: elapsed });
  metrics.createSpan({ cls: "attest-sub-agents__card-model", text: model, attr: { title: model } });
  metrics.createSpan({
    cls: `attest-sub-agents__card-tokens attest-sub-agents__tokens--${tokens.tone}`,
    text: tokens.text,
  });
  setIcon(button.createSpan({ cls: "attest-sub-agents__card-chevron" }), "chevron-right");
  button.addEventListener("click", () => input.onSelect(card.sessionId));
  rendered.cards.set(card.sessionId, button);
  rendered.elapsed.set(card.sessionId, { card, el: elapsedEl });
}

/** Renders a status as a coloured dot followed by its text label. */
export function renderStatus(
  parentEl: HTMLElement,
  card: SubAgentSessionCard,
  label: string,
): HTMLElement {
  const statusEl = parentEl.createSpan({
    cls: `attest-sub-agents__status attest-sub-agents__status--${statusTone(card.status)}`,
  });
  statusEl.createSpan({ cls: "attest-sub-agents__status-dot" });
  statusEl.createSpan({ cls: "attest-sub-agents__status-label", text: label });
  return statusEl;
}
