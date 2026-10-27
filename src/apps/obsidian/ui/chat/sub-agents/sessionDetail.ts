import { setIcon } from "obsidian";

import type {
  SubAgentInspectionDetail,
  SubAgentSessionCard,
} from "@application/contracts/subAgentInspection";
import type { SubAgentRunSummary } from "@core/research";
import { formatElapsed, formatTokens, modelLabel, modelsChanged, statusLabel } from "./format";
import { promptSummary, renderPromptBody } from "./promptSection";
import { renderStatus } from "./sessionList";
import { renderStopArea, type StopState } from "./stopArea";
import { WorkLogView, type WorkLogDeps } from "./workLog";

export interface DetailCallbacks {
  onBack(): void;
  onSelectRun(runId: string): void;
  onStop(): void;
}

export interface DetailState {
  selectedRunId: string | null;
  debug: boolean;
  stop: StopState;
  elapsedOf(card: SubAgentSessionCard): number;
}

interface CollapsibleSection {
  headerEl: HTMLButtonElement;
  summaryEl: HTMLElement;
  bodyEl: HTMLElement;
  open: boolean;
}

/**
 * Renders the details screen of one child session in place: the header, four metrics, the
 * run selector, the two collapsible sections and the stop area. Live updates rewrite the
 * parts but keep the sections' open state and the selector's choice.
 */
export class SessionDetailView {
  private readonly backEl: HTMLButtonElement;
  private readonly debugEl: HTMLElement;
  private readonly descriptionEl: HTMLElement;
  private readonly metricsEl: HTMLElement;
  private readonly runRowEl: HTMLElement;
  private readonly prompt: CollapsibleSection;
  private readonly work: CollapsibleSection;
  private readonly stopEl: HTMLElement;
  private readonly workLog: WorkLogView;
  private detail: SubAgentInspectionDetail | null = null;
  private state: DetailState | null = null;
  private elapsedEl: HTMLElement | null = null;
  private runSignature: string | null = null;
  private promptKey: string | null = null;
  private stopKey: string | null = null;

  constructor(
    containerEl: HTMLElement,
    private readonly deps: WorkLogDeps,
    private readonly callbacks: DetailCallbacks,
  ) {
    const { t } = deps;
    const rootEl = containerEl.createDiv({ cls: "attest-sub-agents__detail" });
    const topEl = rootEl.createDiv({ cls: "attest-sub-agents__detail-top" });
    this.backEl = topEl.createEl("button", {
      cls: "attest-sub-agents__back",
      attr: { type: "button" },
    });
    setIcon(this.backEl.createSpan({ cls: "attest-sub-agents__back-icon" }), "chevron-left");
    this.backEl.createSpan({ text: t("chat.subAgents.back") });
    this.backEl.addEventListener("click", () => callbacks.onBack());
    this.debugEl = topEl.createSpan({
      cls: "attest-sub-agents__debug-badge",
      text: t("chat.subAgents.debug"),
    });
    this.descriptionEl = rootEl.createEl("h3", {
      cls: "attest-sub-agents__description",
      attr: { dir: "auto" },
    });
    this.metricsEl = rootEl.createDiv({ cls: "attest-sub-agents__metrics" });
    this.runRowEl = rootEl.createDiv({ cls: "attest-sub-agents__run-row" });
    const sectionsEl = rootEl.createDiv({ cls: "attest-sub-agents__sections" });
    this.prompt = this.createSection(sectionsEl, t("chat.subAgents.prompt.title"));
    this.work = this.createSection(sectionsEl, t("chat.subAgents.work.title"));
    this.workLog = new WorkLogView(this.work.bodyEl, deps);
    this.stopEl = rootEl.createDiv({ cls: "attest-sub-agents__stop" });
  }

  update(detail: SubAgentInspectionDetail, state: DetailState): void {
    const previousRun = this.state?.selectedRunId;
    this.detail = detail;
    this.state = state;
    const { t } = this.deps;
    this.debugEl.toggleClass("is-hidden", !state.debug);
    this.descriptionEl.setText(detail.card.description);
    this.renderMetrics(detail, state);
    this.renderRunSelector(detail.runs, state.selectedRunId);
    const runIndex = detail.runs.findIndex((run) => run.subAgentRunId === state.selectedRunId);
    const prompt = detail.initialPrompts.find((entry) => entry.runId === state.selectedRunId);
    this.prompt.summaryEl.setText(promptSummary(prompt, runIndex + 1, t));
    const promptKey = this.prompt.open
      ? `${state.selectedRunId}\u0000${JSON.stringify(prompt)}`
      : null;
    if (promptKey !== this.promptKey) {
      this.promptKey = promptKey;
      this.prompt.bodyEl.empty();
      if (this.prompt.open) renderPromptBody(this.prompt.bodyEl, prompt, t);
    }
    this.work.summaryEl.setText(
      t("chat.subAgents.work.summary", {
        runs: detail.runs.length,
        calls: detail.lifetime.length,
        pending: detail.lifetime.filter((item) => item.status === "pending").length,
      }),
    );
    this.renderWorkLog();
    if (this.work.open && previousRun !== undefined && previousRun !== state.selectedRunId) {
      this.workLog.revealSelectedRun();
    }
    this.renderStop(detail, state);
  }

  private renderStop(detail: SubAgentInspectionDetail, state: DetailState): void {
    const { card } = detail;
    const runIndex = detail.runs.findIndex((run) => run.subAgentRunId === card.controlRunId);
    const key = `${state.stop.phase}|${card.canStop}|${runIndex}`;
    if (key === this.stopKey) return;
    this.stopKey = key;
    const hadFocus = this.stopEl.contains(this.stopEl.ownerDocument.activeElement);
    renderStopArea(this.stopEl, card, detail.runs, state.stop, this.deps.t, this.callbacks.onStop);
    if (hadFocus) this.stopEl.querySelector<HTMLButtonElement>("button")?.focus();
  }

  tick(): void {
    if (this.detail && this.state && this.elapsedEl) {
      this.elapsedEl.setText(formatElapsed(this.state.elapsedOf(this.detail.card), this.deps.t));
    }
  }

  focusBack(): void {
    this.backEl.focus();
  }

  dispose(): void {
    this.workLog.dispose();
  }

  private renderWorkLog(): void {
    if (!this.work.open || !this.detail || !this.state) {
      this.workLog.dispose();
      return;
    }
    this.workLog.render({
      sessionId: this.detail.card.sessionId,
      items: this.detail.lifetime,
      selectedRunId: this.state.selectedRunId,
      debug: this.state.debug,
    });
  }

  private createSection(parentEl: HTMLElement, title: string): CollapsibleSection {
    const sectionEl = parentEl.createDiv({ cls: "attest-sub-agents__section" });
    const headerEl = sectionEl.createEl("button", {
      cls: "attest-sub-agents__section-header",
      attr: { type: "button", "aria-expanded": "false" },
    });
    const chevronEl = headerEl.createSpan({ cls: "attest-sub-agents__section-chevron" });
    setIcon(chevronEl, "chevron-right");
    headerEl.createSpan({ cls: "attest-sub-agents__section-title", text: title });
    const summaryEl = headerEl.createSpan({ cls: "attest-sub-agents__section-summary" });
    const bodyEl = sectionEl.createDiv({ cls: "attest-sub-agents__section-body is-hidden" });
    const section: CollapsibleSection = { headerEl, summaryEl, bodyEl, open: false };
    headerEl.addEventListener("click", () => {
      section.open = !section.open;
      headerEl.setAttr("aria-expanded", String(section.open));
      bodyEl.toggleClass("is-hidden", !section.open);
      chevronEl.empty();
      setIcon(chevronEl, section.open ? "chevron-down" : "chevron-right");
      if (this.detail && this.state) this.update(this.detail, this.state);
    });
    return section;
  }

  private renderMetrics(detail: SubAgentInspectionDetail, state: DetailState): void {
    const { t } = this.deps;
    const { card } = detail;
    this.metricsEl.empty();
    const status = this.metric(t("chat.subAgents.metric.status"));
    renderStatus(
      status,
      card,
      state.stop.phase === "pending" ? t("chat.subAgents.stopping") : statusLabel(card.status, t),
    );
    const model = this.metric(t("chat.subAgents.metric.model"));
    const label = modelLabel(card.model, t);
    model.createDiv({
      cls: "attest-sub-agents__metric-value",
      text: label,
      attr: { title: label, dir: "auto" },
    });
    if (modelsChanged(detail.runs)) {
      model.createDiv({
        cls: "attest-sub-agents__metric-note",
        text: t("chat.subAgents.modelsChanged"),
      });
    }
    const elapsed = this.metric(t("chat.subAgents.metric.elapsed"));
    this.elapsedEl = elapsed.createDiv({
      cls: "attest-sub-agents__metric-value attest-sub-agents__numeric",
      text: formatElapsed(state.elapsedOf(card), t),
    });
    const tokens = this.metric(t("chat.subAgents.metric.tokens"));
    const tokenText = formatTokens(card, t);
    tokens.createDiv({
      cls: `attest-sub-agents__metric-value attest-sub-agents__numeric attest-sub-agents__tokens--${tokenText.tone}`,
      text: tokenText.text,
    });
    if (card.usageIncomplete && tokenText.tone !== "none") {
      tokens.createDiv({
        cls: "attest-sub-agents__metric-note",
        text: t("chat.subAgents.partial"),
      });
    }
  }

  private metric(label: string): HTMLElement {
    const metricEl = this.metricsEl.createDiv({ cls: "attest-sub-agents__metric" });
    metricEl.createDiv({ cls: "attest-sub-agents__metric-label", text: label });
    return metricEl;
  }

  private renderRunSelector(
    runs: readonly SubAgentRunSummary[],
    selectedRunId: string | null,
  ): void {
    const { t } = this.deps;
    const labels = runs.map((run, index) =>
      t("chat.subAgents.run.option", {
        run: index + 1,
        attempt: run.attempt,
        state: t(`chat.subAgents.runStatus.${run.status}`),
        model: modelLabel(run.model, t),
      }),
    );
    const signature = JSON.stringify(runs.map((run, index) => [run.subAgentRunId, labels[index]]));
    const existing = this.runRowEl.querySelector<HTMLSelectElement>("select");
    if (signature === this.runSignature && existing) {
      if (selectedRunId && existing.value !== selectedRunId) existing.value = selectedRunId;
      return;
    }
    this.runSignature = signature;
    const hadFocus = existing !== null && existing === existing.ownerDocument.activeElement;
    this.runRowEl.empty();
    this.runRowEl.toggleClass("is-hidden", runs.length < 2);
    if (runs.length < 2) return;
    const labelEl = this.runRowEl.createEl("label", { text: t("chat.subAgents.run.label") });
    const selectEl = labelEl.createEl("select", { cls: "dropdown attest-sub-agents__run-select" });
    runs.forEach((run, index) => {
      const optionEl = selectEl.createEl("option", { text: labels[index], attr: { dir: "auto" } });
      optionEl.value = run.subAgentRunId;
    });
    if (selectedRunId) selectEl.value = selectedRunId;
    selectEl.addEventListener("change", () => this.callbacks.onSelectRun(selectEl.value));
    if (hadFocus) selectEl.focus();
  }
}
