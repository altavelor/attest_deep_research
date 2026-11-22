// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderResearchCard } from "@apps/obsidian/ui/chat/deep-research/researchPlanCard";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { pendingResearch } from "../../support/deepResearch";
import { startResearchState } from "@core/research/deepResearch";

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
    [...first.querySelectorAll("button")].find((button) => button.textContent === "Edit")!.click();
    expect(first.querySelector("textarea")!.getAttribute("maxlength")).toBe("4000");
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

  it("offers Cancel for a research still in planning", () => {
    const state = startResearchState("research-1", "Question", "2026-01-01T00:00:00.000Z");
    const onTurn = vi.fn();
    const host = document.createElement("div");
    renderResearchCard(
      host,
      { researchId: state.researchId, artifact: "plan", revision: state.revision },
      { view: { status: "ready", active: state, history: [] }, t, sentTurns: new Set(), onTurn },
    );
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["Cancel research"]);
    buttons[0]!.click();
    expect(onTurn).toHaveBeenCalledWith(
      { type: "cancel", researchId: state.researchId },
      expect.any(String),
    );
  });
});
