import type { Translate } from "@adapters/i18n";
import type {
  BranchExecution,
  ResearchHistoryEntry,
  ResearchPlan,
  ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { cancelAction, renderActions, type CardAction } from "./researchCardActions";

/**
 * Renders the progress of an approved research: every branch with its execution state and reason,
 * and the budget spent so far. A research that executes while no turn runs is paused and offers
 * Continue and Cancel; an old plan waiting on a stale-plan decision offers its three choices.
 */
export function renderProgress(
  cardEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  context: ResearchCardContext,
): void {
  const { t } = context;
  cardEl.createDiv({
    cls: "attest-research-card__title",
    text: t("chat.deepResearch.progress.title"),
  });
  const listEl = cardEl.createEl("ol", { cls: "attest-research-card__branches" });
  for (const execution of state.executions) {
    const branch = plan.branches.find((entry) => entry.branchId === execution.branchId);
    const itemEl = listEl.createEl("li", {
      cls: `attest-research-card__branch attest-research-card__branch--${execution.state}`,
    });
    itemEl.createDiv({
      cls: "attest-research-card__branch-title",
      text: branch?.title ?? execution.branchId,
    });
    itemEl.createDiv({
      cls: "attest-research-card__branch-notes",
      text: executionNote(execution, t),
    });
  }
  const budget = state.budget;
  if (budget) {
    cardEl.createDiv({
      cls: "attest-research-card__meta",
      text: t("chat.deepResearch.progress.budget", {
        rounds: budget.consumed.modelRounds,
        maxRounds: plan.limits.modelRoundsTotal,
        attempts: budget.consumed.branchAttempts,
        maxAttempts: plan.limits.attemptsTotal,
        minutes: Math.floor(budget.activeMs / 60_000),
        maxMinutes: Math.floor(plan.limits.activeExecutionMs / 60_000),
      }),
    });
  }
  if (context.running) return;
  if (state.pending?.kind === "stale-plan") {
    renderStaleChoices(cardEl, state, context);
    return;
  }
  cardEl.createDiv({ cls: "attest-research-card__notice", text: t("chat.deepResearch.paused") });
  renderActions(cardEl, state, context, [
    {
      label: t("chat.deepResearch.action.continue"),
      turnLabel: t("chat.deepResearch.turn.continue"),
      input: { type: "continue", researchId: state.researchId },
      primary: true,
    },
    cancelAction(state, t),
  ]);
}

/** Renders the card of a finished research from its history entry and report summary. */
export function renderEndedResearch(
  cardEl: HTMLElement,
  entry: ResearchHistoryEntry | undefined,
  t: Translate,
): void {
  const report = entry?.report;
  if (!report) {
    cardEl.createDiv({ cls: "attest-research-card__notice", text: t("chat.deepResearch.ended") });
    if (entry?.terminalReason) {
      cardEl.createDiv({ cls: "attest-research-card__meta", text: entry.terminalReason });
    }
    return;
  }
  cardEl.createDiv({
    cls: "attest-research-card__title",
    text: t("chat.deepResearch.report.title"),
  });
  cardEl.createDiv({
    cls: "attest-research-card__meta",
    text: t(
      report.quality === "complete"
        ? "chat.deepResearch.report.complete"
        : "chat.deepResearch.report.partial",
      {
        completed: report.completedBranches.length,
        total: report.completedBranches.length + report.missingBranches.length,
      },
    ),
  });
  if (report.missingBranches.length > 0) {
    const listEl = cardEl.createEl("ul", { cls: "attest-research-card__branches" });
    for (const missing of report.missingBranches) {
      listEl.createEl("li", {
        cls: "attest-research-card__branch-notes",
        text: t("chat.deepResearch.report.missing", {
          branch: missing.branchId,
          reason: missing.reason,
        }),
      });
    }
  }
  cardEl.createDiv({ cls: "attest-research-card__meta", text: report.stopReason });
}

function renderStaleChoices(
  cardEl: HTMLElement,
  state: ResearchState,
  context: ResearchCardContext,
): void {
  const { t } = context;
  cardEl.createDiv({ cls: "attest-research-card__notice", text: t("chat.deepResearch.stale") });
  const decide = (action: "continue" | "replan" | "cancel", label: string): CardAction => ({
    label,
    turnLabel: label,
    input: {
      type: "decision",
      decision: {
        researchId: state.researchId,
        decisionId: state.pending!.decisionId,
        expectedRevision: state.revision,
        payload: { action },
      },
    },
    primary: action === "continue",
  });
  renderActions(cardEl, state, context, [
    decide("continue", t("chat.deepResearch.action.continueAnyway")),
    decide("replan", t("chat.deepResearch.action.replan")),
    decide("cancel", t("chat.deepResearch.action.cancel")),
  ]);
}

function executionNote(execution: BranchExecution, t: Translate): string {
  const label = t(`chat.deepResearch.state.${execution.state}`);
  const reason = execution.state === "completed" ? null : execution.terminalReason;
  return reason ? `${label} · ${reason}` : label;
}
