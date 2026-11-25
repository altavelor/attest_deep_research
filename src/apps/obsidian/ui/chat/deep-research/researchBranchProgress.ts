import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import {
  branchProgressCounts,
  branchProgressRows,
  budgetLimits,
  type BranchProgressRow,
  type ResearchActivityBudget,
  type ResearchPlan,
  type ResearchState,
} from "@core/research/deepResearch";
import { renderFoldedMarkup } from "../safeMarkupView";
import type { ResearchCardContext } from "./researchCardContext";

const FINDING_PREVIEW_CHARS = 280;

/**
 * Renders the gather wave of an approved research as one block: the phase and the share of
 * finished branches, a segmented bar and a status legend, one numbered row per enabled plan
 * branch with its status and reason, and the spent budget. A row opens in place to its finding,
 * task and agent details; the open rows live in the view, so they stay open across rerenders.
 */
export function renderBranchProgress(
  cardEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const rows = branchProgressRows(plan, state.executions);
  const finished = rows.filter((row) => row.status === "done" || row.status === "partial").length;
  const summary = t("chat.deepResearch.progress.summary", {
    done: finished,
    total: rows.length,
  });
  const blockEl = cardEl.createDiv({ cls: "attest-research-progress" });
  const headEl = blockEl.createDiv({ cls: "attest-research-progress__head" });
  headEl.createDiv({
    cls: "attest-research-progress__title",
    text: t("chat.deepResearch.progress.phase.gathering"),
  });
  headEl.createDiv({ cls: "attest-research-progress__summary", text: summary });
  const barEl = blockEl.createDiv({
    cls: "attest-research-progress__bar",
    attr: { role: "img", "aria-label": summary },
  });
  for (const row of rows) {
    barEl.createDiv({ cls: `attest-research-progress__segment is-${row.status}` });
  }
  const legendEl = blockEl.createDiv({ cls: "attest-research-progress__legend" });
  for (const [status, count] of branchProgressCounts(rows)) {
    const itemEl = legendEl.createSpan({
      cls: `attest-research-progress__legend-item is-${status}`,
    });
    itemEl.createSpan({ cls: "attest-research-progress__dot", attr: { "aria-hidden": "true" } });
    itemEl.appendText(
      t("chat.deepResearch.progress.count", {
        label: t(`chat.deepResearch.progress.status.${status}`),
        count,
      }),
    );
  }
  renderBranchRows(blockEl, state, rows, context);
  renderBudget(blockEl, state, plan, t);
}

/** Renders one numbered row per enabled plan branch; a row opens in place to its details. */
export function renderBranchRows(
  parentEl: HTMLElement,
  state: ResearchState,
  rows: readonly BranchProgressRow[],
  context: ResearchCardContext,
): void {
  const listEl = parentEl.createEl("ol", { cls: "attest-research-progress__rows" });
  for (const row of rows) renderRow(listEl, state, row, context);
}

function renderRow(
  listEl: HTMLElement,
  state: ResearchState,
  row: BranchProgressRow,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const key = `${state.researchId}:${row.branch.branchId}`;
  const expanded = context.expandedBranches?.has(key) ?? false;
  const itemEl = listEl.createEl("li", { cls: `attest-research-progress__row is-${row.status}` });
  const headEl = itemEl.createDiv({ cls: "attest-research-progress__row-head" });
  headEl.createSpan({ cls: "attest-research-progress__number", text: String(row.number) });
  headEl.createSpan({
    cls: "attest-research-progress__row-title",
    text: row.branch.title,
    attr: { title: row.branch.title },
  });
  if (row.execution?.path === "main") {
    headEl.createSpan({
      cls: "attest-research-progress__note",
      text: t("chat.deepResearch.progress.mainPath"),
    });
  }
  if (row.status === "waiting" && row.after.length > 0) {
    headEl.createSpan({
      cls: "attest-research-progress__note",
      text: t("chat.deepResearch.progress.after", { items: row.after.join(", ") }),
    });
  }
  headEl.createSpan({
    cls: `attest-research-progress__chip is-${row.status}`,
    text: t(`chat.deepResearch.progress.status.${row.status}`),
  });
  const toggle = headEl.createEl("button", {
    cls: "attest-research-progress__toggle clickable-icon",
    attr: {
      type: "button",
      "aria-expanded": String(expanded),
      "aria-label": t("chat.deepResearch.progress.expand", { title: row.branch.title }),
    },
  });
  setIcon(toggle, expanded ? "chevron-up" : "chevron-down");
  const reason = row.status === "done" ? null : row.execution?.terminalReason;
  if (reason) itemEl.createDiv({ cls: "attest-research-progress__reason", text: reason });
  const bodyEl = itemEl.createDiv({ cls: "attest-research-progress__body" });
  bodyEl.hidden = !expanded;
  renderRowBody(bodyEl, row, context);
  toggle.addEventListener("click", () => {
    const open = bodyEl.hidden;
    bodyEl.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.empty();
    setIcon(toggle, open ? "chevron-up" : "chevron-down");
    if (open) context.expandedBranches?.add(key);
    else context.expandedBranches?.delete(key);
  });
}

function renderRowBody(
  bodyEl: HTMLElement,
  row: BranchProgressRow,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const finding = row.execution?.finding;
  if (finding?.text) {
    renderFoldedMarkup(
      bodyEl,
      finding.text,
      FINDING_PREVIEW_CHARS,
      t("chat.agent.showFullReply"),
      t,
    );
  }
  bodyEl.createDiv({
    cls: "attest-research-progress__label",
    text: t("chat.deepResearch.progress.task"),
  });
  bodyEl.createDiv({ cls: "attest-research-progress__task", text: row.branch.task });
  const sessionId = row.execution?.runRef?.sessionId;
  const open = context.onOpenSubAgentSession;
  if (!sessionId || !open) return;
  const link = bodyEl.createEl("button", {
    cls: "attest-research-progress__link",
    text: t("chat.deepResearch.progress.details"),
    attr: { type: "button" },
  });
  link.addEventListener("click", () => open(sessionId));
}

/**
 * Renders the spent budget of a research: model rounds, branch attempts and active minutes. The
 * live budget of a running turn, when given, replaces the last committed one.
 */
export function renderBudget(
  blockEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  t: Translate,
  live?: ResearchActivityBudget,
): void {
  const budget = live ?? committedBudget(state);
  if (!budget) return;
  const limits = budgetLimits(plan);
  blockEl.createDiv({
    cls: "attest-research-progress__budget",
    text: t("chat.deepResearch.progress.budget", {
      rounds: budget.modelRounds,
      maxRounds: limits.modelRoundsTotal,
      attempts: budget.branchAttempts,
      maxAttempts: limits.attemptsTotal,
      minutes: Math.floor(budget.activeMs / 60_000),
      maxMinutes: Math.floor(limits.activeExecutionMs / 60_000),
    }),
  });
}

/** Reads the budget of the last committed revision in the shape of a live budget. */
export function committedBudget(state: ResearchState): ResearchActivityBudget | null {
  const budget = state.budget;
  if (!budget) return null;
  return {
    activeMs: budget.activeMs,
    modelRounds: budget.consumed.modelRounds,
    branchAttempts: budget.consumed.branchAttempts,
  };
}
