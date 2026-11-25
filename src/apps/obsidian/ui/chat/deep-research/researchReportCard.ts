import { setIcon } from "obsidian";

import type { Translate } from "@adapters/i18n";
import {
  reportFacts,
  type ReportFacts,
  type ReportOutcome,
  type ReportShare,
  type ResearchHistoryEntry,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import type { ResearchExportController } from "./researchExportController";
import { renderClaimBar } from "./researchClaimBar";

const SHOWN_OBJECTIVES = 3;
const MINUTE_MS = 60_000;
const OUTCOME_ICONS: Record<ReportOutcome, string> = {
  complete: "check-circle",
  partial: "alert-circle",
  failed: "alert-octagon",
  cancelled: "x-circle",
};

/**
 * Renders the final card of a finished research from its history entry: the outcome with its
 * reason and time, the share of gathered branches, verified claims and covered objectives, the
 * missing branches, the claim verification bar, the uncovered objectives and the note export. A
 * research without a report gets a short card with its reason and no export.
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
  const reason = reasonLine(entry, facts, t);
  if (reason) reportEl.createDiv({ cls: "attest-research-report__reason", text: reason });
  if (!facts.report) return;
  renderStats(reportEl, facts, t);
  for (const missing of facts.report.missingBranches) {
    reportEl.createDiv({
      cls: "attest-research-report__missing",
      text: t("chat.deepResearch.report.missingItem", {
        title: missing.title ?? missing.branchId,
        reason: missing.reason,
      }),
    });
  }
  renderClaims(reportEl, facts, t);
  renderUncovered(reportEl, facts.uncovered, t);
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

function reasonLine(entry: ResearchHistoryEntry, facts: ReportFacts, t: Translate): string {
  const scale = facts.report?.scale;
  const reason = facts.report?.stopReason ?? entry.terminalReason ?? "";
  if (!scale || scale.activeLimitMs === 0) return reason;
  const time = t("chat.deepResearch.report.time", {
    minutes: Math.floor(scale.activeMs / MINUTE_MS),
    max: Math.floor(scale.activeLimitMs / MINUTE_MS),
  });
  return reason ? `${reason} · ${time}` : time;
}

function renderStats(reportEl: HTMLElement, facts: ReportFacts, t: Translate): void {
  const statsEl = reportEl.createDiv({ cls: "attest-research-report__stats" });
  const stat = (share: ReportShare | null, caption: Parameters<Translate>[0]): void => {
    if (!share) return;
    const statEl = statsEl.createDiv({
      cls: `attest-research-report__stat ${shareTone(share)}`,
    });
    statEl.createDiv({
      cls: "attest-research-report__stat-value",
      text: `${share.done} / ${share.total}`,
    });
    statEl.createDiv({ cls: "attest-research-report__stat-caption", text: t(caption) });
  };
  stat(facts.branches, "chat.deepResearch.report.stat.branches");
  stat(
    facts.claims && { done: facts.claims.supported, total: facts.claims.total },
    "chat.deepResearch.report.stat.claims",
  );
  stat(facts.objectives, "chat.deepResearch.report.stat.objectives");
}

function shareTone(share: ReportShare): string {
  if (share.done === share.total) return "is-full";
  return share.done === 0 ? "is-none" : "is-some";
}

function renderClaims(reportEl: HTMLElement, facts: ReportFacts, t: Translate): void {
  const claims = facts.claims;
  if (!claims) return;
  const sectionEl = reportEl.createDiv({ cls: "attest-research-report__section" });
  sectionEl.createDiv({
    cls: "attest-research-report__label",
    text: t("chat.deepResearch.report.verification"),
  });
  renderClaimBar(sectionEl, claims, t);
}

function renderUncovered(reportEl: HTMLElement, uncovered: readonly string[], t: Translate): void {
  if (uncovered.length === 0) return;
  const warnEl = reportEl.createDiv({ cls: "attest-research-report__warning" });
  const titleEl = warnEl.createDiv({ cls: "attest-research-report__warning-title" });
  setIcon(titleEl.createSpan({ attr: { "aria-hidden": "true" } }), "alert-triangle");
  titleEl.appendText(t("chat.deepResearch.report.uncovered", { count: uncovered.length }));
  const listEl = warnEl.createEl("ul");
  const hidden: HTMLElement[] = [];
  uncovered.forEach((objective, index) => {
    const itemEl = listEl.createEl("li", { text: objective });
    if (index >= SHOWN_OBJECTIVES) {
      itemEl.hidden = true;
      hidden.push(itemEl);
    }
  });
  if (hidden.length === 0) return;
  const more = warnEl.createEl("button", {
    cls: "attest-research-report__link",
    text: t("chat.deepResearch.report.more", { count: hidden.length }),
    attr: { type: "button" },
  });
  more.addEventListener("click", () => {
    for (const itemEl of hidden) itemEl.hidden = false;
    more.remove();
  });
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
