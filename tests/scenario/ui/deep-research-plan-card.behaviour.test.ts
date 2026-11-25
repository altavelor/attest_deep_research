// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderResearchCard } from "@apps/obsidian/ui/chat/deep-research/researchPlanCard";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { pendingResearch, researchBranch, researchPlan } from "../../support/deepResearch";
import { settle } from "../../support/async";
import { initialExecutions, startResearchState } from "@core/research/deepResearch";

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

  it("edits the plan in place, cancels without sending and commits without a turn", async () => {
    const state = pendingResearch(
      researchPlan([researchBranch(1), researchBranch(2), researchBranch(3)], "conservative"),
    );
    const onTurn = vi.fn();
    const onEditPlan = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "A required branch is disabled." })
      .mockResolvedValueOnce({ ok: true });
    const host = document.createElement("div");
    renderResearchCard(
      host,
      { researchId: state.researchId, artifact: "plan", revision: state.revision },
      {
        view: { status: "ready", active: state, history: [] },
        t,
        sentTurns: new Set(),
        onTurn,
        onEditPlan,
      },
    );
    const button = (label: string, scope: ParentNode = host): HTMLButtonElement =>
      [...scope.querySelectorAll("button")].find((entry) => entry.textContent === label)!;
    const click = (label: string, scope?: ParentNode): void => button(label, scope).click();
    const items = (): HTMLLIElement[] => [...host.querySelectorAll("ol > li")] as HTMLLIElement[];
    const fill = (item: Element, title: string, task: string): void => {
      item.querySelector<HTMLInputElement>("input[type=text]")!.value = title;
      item.querySelector("textarea")!.value = task;
    };

    click("Edit");
    expect(host.querySelectorAll("li textarea")).toHaveLength(3);
    expect(host.querySelector("li textarea")!.getAttribute("maxlength")).toBe("4000");
    click("Cancel editing");
    expect(host.querySelector("li textarea")).toBeNull();
    click("Edit");
    for (let added = 0; added < 4; added += 1) click("Add branch");
    expect(button("Add branch").disabled).toBe(true);
    expect(host.textContent).toContain("At most 7 enabled branches");
    const toggle = (checked: boolean): void => {
      const box = items()[0]!.querySelector<HTMLInputElement>("input[type=checkbox]")!;
      box.checked = checked;
      box.dispatchEvent(new Event("change"));
    };
    const struck = (): boolean =>
      items()[0]!.classList.contains("attest-research-card__branch--disabled");
    toggle(false);
    expect(struck()).toBe(true);
    expect(button("Add branch").disabled).toBe(false);
    for (let added = 0; added < 4; added += 1) click("Remove", items()[3]);
    toggle(true);
    expect(struck()).toBe(false);
    toggle(false);
    fill(items()[0]!, "Tides", "Measure tides");
    items()[1]!.querySelector("select")!.value = "optional";
    click("Remove", items()[2]);
    click("Add branch");
    fill(items()[2]!, "Dropped", "Gone");
    click("Remove", items()[2]);
    click("Add branch");
    fill(items()[2]!, "Costs", "Compare costs");
    click("Add branch");
    click("↑", items()[2]);
    expect(items()[1]!.querySelector<HTMLInputElement>("input[type=text]")!.value).toBe("Costs");
    expect(button("↑", items()[0]).disabled).toBe(true);
    click("Add omission");
    host.querySelector<HTMLInputElement>("ul input")!.value = "Dropped";
    click("Remove", host.querySelector("ul")!);
    click("Add omission");
    host.querySelector<HTMLInputElement>("ul input")!.value = " No budget ";
    click("Add omission");
    click("Save changes");
    click("Save changes");
    await settle();
    expect(host.textContent).toContain("The plan was not saved: A required branch is disabled.");
    click("Save changes");
    await settle();

    expect(onTurn).not.toHaveBeenCalled();
    expect(onEditPlan).toHaveBeenCalledTimes(2);
    expect(onEditPlan).toHaveBeenLastCalledWith({
      researchId: state.researchId,
      decisionId: "decision-1",
      expectedRevision: state.revision,
      branches: [
        {
          branchId: "branch-1",
          enabled: false,
          title: "Tides",
          task: "Measure tides",
          priority: "required",
        },
        {
          branchId: "branch-2",
          enabled: true,
          title: "Branch 2",
          task: "Investigate aspect 2",
          priority: "optional",
        },
      ],
      added: [{ title: "Costs", task: "Compare costs" }],
      removed: ["branch-3"],
      order: ["branch-1", 0, "branch-2"],
      knownOmissions: ["No budget"],
    });
  });

  it("sends the regeneration instruction typed under the plan", () => {
    const state = pendingResearch();
    const onTurn = vi.fn();
    const host = document.createElement("div");
    renderResearchCard(
      host,
      { researchId: state.researchId, artifact: "plan", revision: state.revision },
      { view: { status: "ready", active: state, history: [] }, t, sentTurns: new Set(), onTurn },
    );
    host.querySelector("textarea")!.value = " Focus on costs ";
    [...host.querySelectorAll("button")]
      .find((entry) => entry.textContent === "Regenerate")!
      .click();
    expect(onTurn).toHaveBeenCalledWith(
      {
        type: "decision",
        decision: {
          researchId: state.researchId,
          decisionId: "decision-1",
          expectedRevision: state.revision,
          payload: { action: "regenerate", instruction: "Focus on costs" },
        },
      },
      "Regenerate the research plan: Focus on costs",
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

  it("shows a paused research with its branch states and sends Continue", () => {
    const pending = pendingResearch();
    const state = {
      ...pending,
      phase: "gathering" as const,
      pending: null,
      plan: { ...pending.plan!, approvedAt: "2026-01-01T00:00:00.000Z" },
      executions: initialExecutions(pending.plan!).map((execution, index) =>
        index === 0
          ? { ...execution, state: "failed" as const, terminalReason: "Provider down" }
          : execution,
      ),
    };
    const onTurn = vi.fn();
    const host = document.createElement("div");
    renderResearchCard(
      host,
      { researchId: state.researchId, artifact: "plan", revision: state.revision },
      { view: { status: "ready", active: state, history: [] }, t, sentTurns: new Set(), onTurn },
    );
    expect(host.textContent).toContain("Failed · Provider down");
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Continue")!
      .click();
    expect(onTurn).toHaveBeenCalledWith(
      { type: "continue", researchId: state.researchId },
      "Continue the research",
    );
  });

  it("asks for a supplied observation under the hypothesis list and sends it as the decision", () => {
    const pending = pendingResearch();
    const hypothesis = {
      hypothesisId: "h-1",
      revision: 1,
      previousRevision: null,
      branchId: "branch-1",
      claim: "<b>Moon</b> drives tides",
      alternative: "Wind",
      prediction: "Lunar cycle",
      disconfirmation: "No cycle",
      status: "untested" as const,
      observationIds: [],
    };
    const state = {
      ...pending,
      phase: "awaiting-observation" as const,
      pending: {
        decisionId: "decision-o",
        kind: "observation" as const,
        artifactRevision: 1,
        subjectId: "t-1",
      },
      plan: { ...pending.plan!, approvedAt: "2026-01-01T00:00:00.000Z" },
      discovery: {
        hypotheses: [hypothesis],
        tests: [
          {
            testId: "t-1",
            hypothesisId: "h-1",
            hypothesisRevision: 1,
            kind: "supplied-observation" as const,
            method: "Log tide times",
            status: "awaiting-input" as const,
          },
        ],
        observations: [],
        cycles: [],
        notes: [],
        executions: [],
        omissions: [],
      },
    };
    const onTurn = vi.fn();
    const host = document.createElement("div");
    renderResearchCard(
      host,
      { researchId: state.researchId, artifact: "plan", revision: state.revision },
      { view: { status: "ready", active: state, history: [] }, t, sentTurns: new Set(), onTurn },
    );
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("<b>Moon</b> drives tides");
    expect(host.textContent).toContain("Observation needed: Log tide times");
    const buttons = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).not.toContain("Continue");
    host.querySelector("textarea")!.value = " Tides followed the moon ";
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Send observation")!
      .click();
    expect(onTurn).toHaveBeenCalledWith(
      {
        type: "decision",
        decision: {
          researchId: state.researchId,
          decisionId: "decision-o",
          expectedRevision: state.revision,
          payload: { action: "observe", testId: "t-1", text: "Tides followed the moon" },
        },
      },
      "Send the observation",
    );
    const skipHost = document.createElement("div");
    renderResearchCard(
      skipHost,
      { researchId: state.researchId, artifact: "plan", revision: state.revision },
      { view: { status: "ready", active: state, history: [] }, t, sentTurns: new Set(), onTurn },
    );
    [...skipHost.querySelectorAll("button")]
      .find((button) => button.textContent === "Skip observations")!
      .click();
    expect(onTurn).toHaveBeenLastCalledWith(
      {
        type: "decision",
        decision: {
          researchId: state.researchId,
          decisionId: "decision-o",
          expectedRevision: state.revision,
          payload: { action: "skip-observations", testId: "t-1" },
        },
      },
      "Skip the observations",
    );
  });

  it("renders a finished partial report with its verification sections from the history", () => {
    const host = document.createElement("div");
    const entry = {
      researchId: "research-1",
      question: "Q",
      phase: "completed" as const,
      terminalReason: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      report: {
        reportId: "report-1",
        quality: "partial" as const,
        completedBranches: ["branch-1"],
        missingBranches: [{ branchId: "branch-2", reason: "Time" }],
        stopReason: "The active execution time limit was reached.",
        createdAt: "2026-01-01T00:00:00.000Z",
        verification: {
          supported: 2,
          conflicted: 1,
          unsupported: 1,
          unresolved: 2,
          uncoveredObjectives: ["Explain neap tides"],
        },
      },
    };
    renderResearchCard(
      host,
      { researchId: "research-1", artifact: "plan", revision: 9 },
      {
        view: { status: "ready", active: null, history: [entry] },
        t,
        sentTurns: new Set(),
        onTurn: vi.fn(),
      },
    );
    expect(host.textContent).toContain("Partial: 1 of 2 branches");
    expect(host.textContent).toContain("Missing branch-2: Time");
    expect(host.textContent).toContain("Conflicting claims: 1");
    expect(host.textContent).toContain("Unsupported or unresolved claims: 3");
    expect(host.textContent).toContain("Explain neap tides");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});
