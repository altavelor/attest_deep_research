import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import {
  reportFacts,
  type ReportFacts,
  type ReportOutcome,
  type ReportShare,
  type ReportWarning,
  type ResearchHistoryEntry,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import type { ResearchExportController } from "./researchExportController";

const OUTCOME_ICONS: Record<ReportOutcome, string> = {
  complete: "check-circle",
  partial: "alert-circle",
  failed: "alert-octagon",
  cancelled: "x-circle",
};

/**
 * Renders the final card of a finished research from its history entry: the outcome with its
 * reason, the gathered branches, the cited sources and the run time, the warnings and missing
 * branches, and the note export. A research without a report gets a short card with its reason and
 * no export.
 */
export function renderEndedResearch(
  cardEl: HTMLElement,
  entry: ResearchHistoryEntry | undefined,
  t: Translate,
  exports?: ResearchCardContext["exports"],
): void {
  if (!entry) {
    cardEl.createDiv({ cls: "attest-research-card__notice", text: t("chat.deepResearch.ended") });
    return;
  }
  const facts = reportFacts(entry);
  const reportEl = cardEl.createDiv({
    cls: `attest-research-report is-${facts.outcome}`,
    attr: { "data-research-report": entry.researchId },
  });
  const headEl = reportEl.createDiv({ cls: "attest-research-report__head" });
  setIcon(
    headEl.createSpan({
      cls: "attest-research-report__icon",
      attr: { "aria-hidden": "true", "data-icon": OUTCOME_ICONS[facts.outcome] },
    }),
    OUTCOME_ICONS[facts.outcome],
  );
  headEl.createDiv({
    cls: "attest-research-report__title",
    text: t(`chat.deepResearch.report.heading.${facts.outcome}`),
  });
  headEl.createSpan({
    cls: `attest-research-report__chip is-${facts.outcome}`,
    text: t(`chat.deepResearch.report.outcome.${facts.outcome}`),
  });
  const reason = facts.report?.stopReason ?? entry.terminalReason ?? "";
  if (reason) reportEl.createDiv({ cls: "attest-research-report__reason", text: reason });
  if (!facts.report) return;
  renderStats(reportEl, facts, t);
  for (const warning of facts.warnings) {
    reportEl.createDiv({
      cls: "attest-research-report__warning",
      text: warningText(warning, t),
    });
  }
  for (const missing of facts.report.missingBranches) {
    reportEl.createDiv({
      cls: "attest-research-report__missing",
      text: t("chat.deepResearch.report.missingItem", {
        title: missing.title ?? missing.branchId,
        reason: missing.reason,
      }),
    });
  }
  if (exports) renderExport(reportEl, entry.researchId, t, exports);
}

/**
 * Renders the compact line that an earlier turn of a finished research shows instead of a second
 * report, with a link that scrolls to the research's final card.
 */
export function renderEarlierTurn(cardEl: HTMLElement, researchId: string, t: Translate): void {
  const lineEl = cardEl.createDiv({ cls: "attest-research-report__earlier" });
  lineEl.createSpan({ text: t("chat.deepResearch.report.earlier") });
  const link = lineEl.createEl("button", {
    cls: "attest-research-report__link",
    text: t("chat.deepResearch.report.jump"),
    attr: { type: "button" },
  });
  link.addEventListener("click", () => {
    const transcript = cardEl.closest(".attest-chat__transcript") ?? cardEl.ownerDocument;
    transcript
      .querySelector(`[data-research-report="${researchId}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function renderStats(reportEl: HTMLElement, facts: ReportFacts, t: Translate): void {
  const statsEl = reportEl.createDiv({ cls: "attest-research-report__stats" });
  const stat = (value: string, caption: string, tone: string): void => {
    const statEl = statsEl.createDiv({ cls: `attest-research-report__stat ${tone}` });
    statEl.createDiv({ cls: "attest-research-report__stat-value", text: value });
    statEl.createDiv({ cls: "attest-research-report__stat-caption", text: caption });
  };
  const { branches, sources, time } = facts;
  if (branches) {
    stat(
      `${branches.done} / ${branches.total}`,
      t("chat.deepResearch.report.stat.branches"),
      shareTone(branches),
    );
  }
  if (sources) {
    stat(
      `${sources.done} / ${sources.total}`,
      t("chat.deepResearch.report.stat.sources"),
      "is-neutral",
    );
  }
  if (time) {
    stat(
      t("chat.deepResearch.report.stat.minutes", { minutes: time.minutes }),
      t("chat.deepResearch.report.stat.time", { max: time.limitMinutes }),
      "is-neutral",
    );
  }
}

function warningText(warning: ReportWarning, t: Translate): string {
  if (warning.kind === "summaryFailure") {
    return t("chat.deepResearch.report.warning.summaryFailure", { reason: warning.reason });
  }
  if (warning.kind === "noDocuments") return t("chat.deepResearch.report.warning.noDocuments");
  if (warning.kind === "uncitedBranches") {
    return t("chat.deepResearch.report.warning.uncitedBranches", {
      titles: warning.titles.join(", "),
    });
  }
  return t("chat.deepResearch.report.warning.removedCitations", { count: warning.count });
}

function shareTone(share: ReportShare): string {
  if (share.done === share.total) return "is-full";
  return share.done === 0 ? "is-none" : "is-some";
}

/**
 * Renders the export row of a finished report from the view's export state: one action, the
 * target folder as a link that opens an override field, and the pending, exported or failed
 * status. The action is disabled while an export runs and turns into a retry after a failure.
 */
function renderExport(
  reportEl: HTMLElement,
  researchId: string,
  t: Translate,
  exports: ResearchExportController,
): void {
  const state = exports.state(researchId);
  const sectionEl = reportEl.createDiv({ cls: "attest-research-report__section" });
  const rowEl = sectionEl.createDiv({ cls: "attest-research-report__export" });
  const button = rowEl.createEl("button", {
    cls: "attest-research-card__action mod-cta",
    text: t(
      state.kind === "failed"
        ? "chat.deepResearch.action.retryExport"
        : "chat.deepResearch.action.export",
    ),
  });
  button.disabled = state.kind === "pending";
  const draft = exports.draft(researchId);
  const folderEl = rowEl.createSpan({ cls: "attest-research-report__folder" });
  folderEl.appendText(t("chat.deepResearch.export.into"));
  const folderLink = folderEl.createEl("button", {
    cls: "attest-research-report__link",
    text: draft || exports.defaultFolder(),
    attr: { type: "button", "aria-expanded": String(draft !== "") },
  });
  const inputEl = sectionEl.createEl("input", {
    cls: "attest-research-card__export-folder",
    attr: {
      type: "text",
      placeholder: exports.defaultFolder(),
      "aria-label": t("chat.deepResearch.export.folder"),
    },
  });
  inputEl.value = draft;
  inputEl.hidden = draft === "";
  folderLink.addEventListener("click", () => {
    inputEl.hidden = !inputEl.hidden;
    folderLink.setAttribute("aria-expanded", String(!inputEl.hidden));
    if (!inputEl.hidden) inputEl.focus();
  });
  inputEl.addEventListener("input", () => {
    exports.setDraft(researchId, inputEl.value);
    folderLink.setText(inputEl.value || exports.defaultFolder());
  });
  button.addEventListener("click", () => exports.start(researchId, inputEl.value));
  if (state.kind === "idle") return;
  const statusEl = sectionEl.createDiv({ cls: "attest-research-report__status" });
  if (state.kind === "pending") statusEl.setText(t("chat.deepResearch.export.running"));
  if (state.kind === "done") {
    statusEl.setText(t("chat.deepResearch.export.done", { path: state.path }));
  }
  if (state.kind === "failed") {
    statusEl.addClass("is-error");
    statusEl.setText(t("chat.deepResearch.export.failed", { reason: state.reason }));
  }
}
