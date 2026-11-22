// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderResearchCard } from "@apps/obsidian/ui/chat/deep-research/researchPlanCard";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { pendingResearch } from "../../support/deepResearch";

const t = createTranslator("en").t;

beforeEach(() => installObsidianDomHelpers());
afterEach(() => resetDom());

describe("deep research plan card", () => {
  it("sends the pending decision identity once, also after a rerender", () => {
    const state = pendingResearch();
    const onTurn = vi.fn();
    const context = {
      view: { status: "ready" as const, active: state, history: [] },
      t,
      sentTurns: new Set<string>(),
      onTurn,
    };
    const reference = { researchId: state.researchId, artifact: "plan", revision: state.revision };
    const render = (): HTMLElement => {
      const host = document.createElement("div");
      renderResearchCard(host, reference, context);
      return host;
    };
    const approve = (host: HTMLElement): HTMLButtonElement =>
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Approve")!;

    const first = render();
    expect(first.textContent).toContain("Investigate aspect 1");
    approve(first).click();
    approve(first).click();
    const rerendered = render();
    expect(approve(rerendered).disabled).toBe(true);
    approve(rerendered).click();

    expect(onTurn).toHaveBeenCalledTimes(1);
    expect(onTurn).toHaveBeenCalledWith(
      {
        type: "decision",
        decision: {
          researchId: state.researchId,
          decisionId: "decision-1",
          expectedRevision: state.revision,
          payload: { action: "approve" },
        },
      },
      "Approve the research plan",
    );
  });
});
