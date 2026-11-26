import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import {
  branchProgressRows,
  budgetLimits,
  currentStageNumber,
  formatClock,
  researchStages,
  type ResearchActivity,
  type ResearchPlan,
  type ResearchStage,
  type ResearchStageRow,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { committedBudget, renderBranchRows, renderBudget } from "./researchBranchProgress";
import { renderStageBody } from "./researchStageDetails";

const STAGE_TITLES: Record<ResearchStage, Parameters<Translate>[0]> = {
  hypotheses: "chat.deepResearch.progress.stage.hypotheses",
  writing: "chat.deepResearch.progress.stage.writing",
};
const MARKER_ICONS = { done: "check", pending: "circle", skipped: "minus" } as const;
const CLOCK_SELECTOR = ".attest-research-stage__time[data-started-at]";

/**
 * Renders the stages that follow the gather wave: the current stage number with the active time,
 * the gathered plan items folded into one line that opens the item rows, and one step per stage
 * with its status, time and details. Live details come from the activity of the running turn; the
 * clock of the running stage keeps ticking through {@link tickStageClocks}.
 */
export function renderStageProgress(
  cardEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const activity =
    context.running && context.activity?.researchId === state.researchId ? context.activity : null;
  const stages = researchStages(state, plan);
  const budget = activity?.budget ?? committedBudget(state);
  const blockEl = cardEl.createDiv({ cls: "attest-research-progress attest-research-stages" });
  const headEl = blockEl.createDiv({ cls: "attest-research-progress__head" });
  headEl.createDiv({
    cls: "attest-research-progress__title",
    text: t("chat.deepResearch.progress.stageOf", {
      current: currentStageNumber(stages),
      total: stages.length,
    }),
  });
  if (budget) {
    headEl.createDiv({
      cls: "attest-research-progress__summary",
      text: t("chat.deepResearch.progress.time", {
        minutes: Math.floor(budget.activeMs / 60_000),
        max: Math.floor(budgetLimits(plan).activeExecutionMs / 60_000),
      }),
    });
  }
  renderGathered(blockEl, state, plan, context);
  const listEl = blockEl.createEl("ol", { cls: "attest-research-stages__list" });
  const now = context.now?.() ?? Date.now();
  for (const row of stages) renderStage(listEl, state, plan, row, activity, now, context);
  renderBudget(blockEl, state, plan, t, activity?.budget);
}

/** Updates the clock of every running stage under the given element to the given time. */
export function tickStageClocks(rootEl: HTMLElement, now: number): void {
  for (const clockEl of rootEl.querySelectorAll<HTMLElement>(CLOCK_SELECTOR)) {
    const startedAt = Number(clockEl.dataset.startedAt);
    if (Number.isFinite(startedAt)) clockEl.setText(formatClock(now - startedAt));
  }
}

function renderGathered(
  blockEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const rows = branchProgressRows(plan, state.executions);
  const done = rows.filter((row) => row.status === "done" || row.status === "partial").length;
  const key = `${state.researchId}:gathered`;
  const open = context.expandedBranches?.has(key) ?? false;
  const lineEl = blockEl.createDiv({
    cls: `attest-research-stages__gathered ${done === rows.length ? "is-full" : "is-some"}`,
  });
  setIcon(
    lineEl.createSpan({
      cls: "attest-research-stages__gathered-icon",
      attr: { "aria-hidden": "true" },
    }),
    done === rows.length ? "check" : "alert-circle",
  );
  lineEl.createSpan({
    cls: "attest-research-stages__gathered-text",
    text: t("chat.deepResearch.progress.gathered", { done, total: rows.length }),
  });
  const toggle = lineEl.createEl("button", {
    cls: "attest-research-report__link",
    text: t(open ? "chat.deepResearch.progress.hide" : "chat.deepResearch.progress.show"),
    attr: { type: "button", "aria-expanded": String(open) },
  });
  const rowsEl = blockEl.createDiv({ cls: "attest-research-stages__rows" });
  rowsEl.hidden = !open;
  renderBranchRows(rowsEl, state, rows, context);
  toggle.addEventListener("click", () => {
    rowsEl.hidden = !rowsEl.hidden;
    toggle.setText(
      t(rowsEl.hidden ? "chat.deepResearch.progress.show" : "chat.deepResearch.progress.hide"),
    );
    toggle.setAttribute("aria-expanded", String(!rowsEl.hidden));
    if (rowsEl.hidden) context.expandedBranches?.delete(key);
    else context.expandedBranches?.add(key);
  });
}

function renderStage(
  listEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  row: ResearchStageRow,
  activity: ResearchActivity | null,
  now: number,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const live = row.status === "running" && activity !== null;
  const itemEl = listEl.createEl("li", {
    cls: `attest-research-stage is-${row.status}${live ? " is-live" : ""}`,
  });
  const markerEl = itemEl.createSpan({
    cls: "attest-research-stage__marker",
    attr: { "aria-hidden": "true" },
  });
  if (row.status === "running") markerEl.createSpan({ cls: "attest-research-stage__pulse" });
  else setIcon(markerEl, MARKER_ICONS[row.status]);
  itemEl.createSpan({ cls: "attest-research-stage__name", text: t(STAGE_TITLES[row.stage]) });
  const timeEl = itemEl.createSpan({ cls: "attest-research-stage__time" });
  const time = activity?.stages[row.stage];
  if (live && time && time.endedAt === undefined) {
    timeEl.dataset.startedAt = String(time.startedAt);
    timeEl.setText(formatClock(now - time.startedAt));
  } else if (row.status === "done" && time?.endedAt !== undefined) {
    timeEl.setText(formatClock(time.endedAt - time.startedAt));
  } else if (row.status === "pending") {
    timeEl.setText("—");
  }
  const bodyEl = itemEl.createDiv({ cls: "attest-research-stage__body" });
  renderStageBody(
    bodyEl,
    state,
    plan,
    row,
    live && activity.stage === row.stage ? activity : null,
    context,
  );
  if (bodyEl.childElementCount === 0) bodyEl.remove();
}
