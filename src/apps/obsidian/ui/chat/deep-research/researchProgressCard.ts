import type { Translate } from "@adapters/i18n";
import type {
  BranchExecution,
  ReportVerificationCounts,
  ResearchHistoryEntry,
  ResearchPlan,
  ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import type { ResearchExportController } from "./researchExportController";
import { cancelAction, renderActions, type CardAction } from "./researchCardActions";
import { renderDiscovery } from "./researchDiscoveryCard";

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
  if (state.discovery) renderDiscovery(cardEl, state, state.discovery, context);
  if (context.running || state.pending?.kind === "observation") return;
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
  exports?: ResearchCardContext["exports"],
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
  if (report.verification) renderVerification(cardEl, report.verification, t);
  cardEl.createDiv({ cls: "attest-research-card__meta", text: report.stopReason });
  if (exports && entry) renderExport(cardEl, entry.researchId, t, exports);
}

/**
 * Renders the export control of a finished report from the view's export state: an optional
 * folder override, the action, and the pending, exported or failed status. The action is disabled
 * while an export runs and turns into a retry after a failure.
 */
function renderExport(
  cardEl: HTMLElement,
  researchId: string,
  t: Translate,
  exports: ResearchExportController,
): void {
  const state = exports.state(researchId);
  const actionsEl = cardEl.createDiv({ cls: "attest-research-card__actions" });
  const folderEl = actionsEl.createEl("input", {
    cls: "attest-research-card__export-folder",
    attr: {
      type: "text",
      placeholder: exports.defaultFolder(),
      "aria-label": t("chat.deepResearch.export.folder"),
    },
  });
  const button = actionsEl.createEl("button", {
    cls: "attest-research-card__action",
    text: t(
      state.kind === "failed"
        ? "chat.deepResearch.action.retryExport"
        : "chat.deepResearch.action.export",
    ),
  });
  button.disabled = state.kind === "pending";
  button.addEventListener("click", () => exports.start(researchId, folderEl.value));
  if (state.kind === "idle") return;
  const statusEl = cardEl.createDiv({ cls: "attest-research-card__meta" });
  if (state.kind === "pending") statusEl.setText(t("chat.deepResearch.export.running"));
  if (state.kind === "done") {
    statusEl.setText(t("chat.deepResearch.export.done", { path: state.path }));
  }
  if (state.kind === "failed") {
    statusEl.addClass("attest-research-card__notice--error");
    statusEl.setText(t("chat.deepResearch.export.failed", { reason: state.reason }));
  }
}

function renderVerification(
  cardEl: HTMLElement,
  counts: ReportVerificationCounts,
  t: Translate,
): void {
  const sectionEl = cardEl.createDiv({ cls: "attest-research-card__verification" });
  sectionEl.createDiv({
    cls: "attest-research-card__meta",
    text: t("chat.deepResearch.report.supported", { count: counts.supported }),
  });
  if (counts.conflicted > 0) {
    sectionEl.createDiv({
      cls: "attest-research-card__notice",
      text: t("chat.deepResearch.report.conflicted", { count: counts.conflicted }),
    });
  }
  const weak = counts.unsupported + counts.unresolved;
  if (weak > 0) {
    sectionEl.createDiv({
      cls: "attest-research-card__notice",
      text: t("chat.deepResearch.report.unsupported", { count: weak }),
    });
  }
  if (counts.uncoveredObjectives.length > 0) {
    sectionEl.createDiv({
      cls: "attest-research-card__branch-title",
      text: t("chat.deepResearch.report.uncovered"),
    });
    const listEl = sectionEl.createEl("ul", { cls: "attest-research-card__branches" });
    for (const objective of counts.uncoveredObjectives) {
      listEl.createEl("li", { cls: "attest-research-card__branch-notes", text: objective });
    }
  }
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
