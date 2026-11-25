import { setIcon } from "obsidian";

import {
  claimTally,
  executionProgressStatus,
  writingSections,
  type ResearchActivity,
  type ResearchPlan,
  type ResearchStageRow,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { researchStepText } from "./researchActivityText";
import { renderClaimBar } from "./researchClaimBar";
import { renderHypotheses } from "./researchDiscoveryCard";

/**
 * Renders the details of one stage after the gather wave: what the running turn does right now,
 * then the stage's own content: the hypotheses with their tests, the claim tally, the follow-up
 * searches, or the report sections written so far.
 */
export function renderStageBody(
  bodyEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  row: ResearchStageRow,
  activity: ResearchActivity | null,
  context: ResearchCardContext,
): void {
  if (activity) renderNow(bodyEl, researchStepText(activity.step, context.t));
  if (row.stage === "hypotheses" && row.status !== "pending" && state.discovery) {
    renderHypotheses(bodyEl, state, state.discovery, context, row.status === "done");
  }
  if (row.stage === "verification") renderVerification(bodyEl, state, row, activity, context);
  if (row.stage === "follow-ups") renderFollowUps(bodyEl, state, plan, row, context);
  if (row.stage === "writing" && row.status === "running") {
    renderWriting(bodyEl, plan, activity);
  }
}

function renderNow(bodyEl: HTMLElement, text: string): void {
  const nowEl = bodyEl.createDiv({ cls: "attest-research-stage__now" });
  nowEl.createSpan({ cls: "attest-research-stage__pulse", attr: { "aria-hidden": "true" } });
  nowEl.appendText(text);
}

function renderVerification(
  bodyEl: HTMLElement,
  state: ResearchState,
  row: ResearchStageRow,
  activity: ResearchActivity | null,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const step = activity?.step;
  if (step?.kind === "checking") {
    renderSub(bodyEl, t("chat.deepResearch.progress.extracted", { count: step.tally.total }));
    const { supported, conflicted, unverified, total } = step.tally;
    renderClaimBar(bodyEl, step.tally, t, total - supported - conflicted - unverified);
    return;
  }
  const verification = state.verification;
  if (row.status === "pending" || !verification || verification.claims.length === 0) return;
  renderSub(bodyEl, t("chat.deepResearch.progress.checked", { count: verification.claims.length }));
  renderClaimBar(bodyEl, claimTally(verification.assessments, verification.claims.length), t);
}

function renderFollowUps(
  bodyEl: HTMLElement,
  state: ResearchState,
  plan: ResearchPlan,
  row: ResearchStageRow,
  context: ResearchCardContext,
): void {
  const { t } = context;
  if (row.status === "pending") {
    renderSub(
      bodyEl,
      t("chat.deepResearch.progress.followUpsPlanned", {
        count: plan.limits.verificationFollowUps,
      }),
      true,
    );
    return;
  }
  if (row.status === "skipped") {
    renderSub(bodyEl, t("chat.deepResearch.progress.stageSkipped"), true);
    return;
  }
  const listEl = bodyEl.createEl("ul", { cls: "attest-research-stage__items" });
  for (const execution of state.verification?.followUps ?? []) {
    const status = executionProgressStatus(execution);
    const itemEl = listEl.createEl("li", { cls: `attest-research-stage__item is-${status}` });
    itemEl.createSpan({
      cls: `attest-research-progress__chip is-${status}`,
      text: t(`chat.deepResearch.progress.status.${status}`),
    });
    itemEl.createSpan({
      cls: "attest-research-stage__item-text",
      text: plan.branches.find((branch) => branch.branchId === execution.branchId)?.title ?? "",
    });
  }
}

function renderWriting(
  bodyEl: HTMLElement,
  plan: ResearchPlan,
  activity: ResearchActivity | null,
): void {
  const step = activity?.step.kind === "writing" ? activity.step : null;
  const listEl = bodyEl.createEl("ul", { cls: "attest-research-stage__items" });
  for (const section of writingSections(plan.reportOutline, step?.headings ?? [])) {
    const itemEl = listEl.createEl("li", {
      cls: `attest-research-stage__item is-${section.status}`,
    });
    const markerEl = itemEl.createSpan({
      cls: "attest-research-stage__item-marker",
      attr: { "aria-hidden": "true" },
    });
    if (section.status === "current" && step) {
      markerEl.createSpan({ cls: "attest-research-stage__pulse" });
    } else {
      setIcon(markerEl, section.status === "done" ? "check" : "circle");
    }
    itemEl.createSpan({ cls: "attest-research-stage__item-text", text: section.title });
  }
  if (listEl.childElementCount === 0) listEl.remove();
}

function renderSub(bodyEl: HTMLElement, text: string, muted = false): void {
  bodyEl.createDiv({
    cls: `attest-research-stage__sub${muted ? " is-muted" : ""}`,
    text,
  });
}
