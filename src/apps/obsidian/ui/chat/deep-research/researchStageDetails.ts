import { setIcon } from "obsidian";

import {
  writingSections,
  type ResearchActivity,
  type ResearchPlan,
  type ResearchStageRow,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { researchStepText } from "./researchActivityText";
import { renderHypotheses } from "./researchDiscoveryCard";

/**
 * Renders the details of one stage after the gather wave: what the running turn does right now,
 * then the stage's own content: the hypotheses with their tests, or the report sections written
 * so far.
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
  if (row.stage === "writing" && row.status === "running") {
    renderWriting(bodyEl, plan, activity);
  }
}

function renderNow(bodyEl: HTMLElement, text: string): void {
  const nowEl = bodyEl.createDiv({ cls: "attest-research-stage__now" });
  nowEl.createSpan({ cls: "attest-research-stage__pulse", attr: { "aria-hidden": "true" } });
  nowEl.appendText(text);
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
