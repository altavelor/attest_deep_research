// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "@adapters/i18n";
import { renderResearchCard } from "@apps/obsidian/ui/chat/deep-research/researchPlanCard";
import { tickStageClocks } from "@apps/obsidian/ui/chat/deep-research/researchStageProgress";
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

  it("shows a paused research as numbered branch rows that open in place and sends Continue", () => {
    const pending = pendingResearch(
      researchPlan([
        researchBranch(1),
        researchBranch(2),
        researchBranch(3, { dependsOn: ["branch-1"] }),
      ]),
    );
    const state = {
      ...pending,
      phase: "gathering" as const,
      pending: null,
      plan: { ...pending.plan!, approvedAt: "2026-01-01T00:00:00.000Z" },
      executions: initialExecutions(pending.plan!).map((execution, index) =>
        index === 0
          ? {
              ...execution,
              state: "failed" as const,
              path: "main" as const,
              terminalReason: "Provider down",
            }
          : index === 2
            ? execution
            : {
                ...execution,
                state: "completed" as const,
                finding: { text: "Found tides", citationTokens: [], partial: true },
                runRef: { sessionId: "s-2", runId: "r-2", resultRevision: 1 },
              },
      ),
    };
    const onTurn = vi.fn();
    const onOpenSubAgentSession = vi.fn();
    const context = {
      view: { status: "ready" as const, active: state, history: [] },
      t,
      sentTurns: new Set<string>(),
      expandedBranches: new Set<string>(),
      onTurn,
      onOpenSubAgentSession,
    };
    const render = (): HTMLElement => {
      const host = document.createElement("div");
      renderResearchCard(
        host,
        { researchId: state.researchId, artifact: "plan", revision: state.revision },
        context,
      );
      return host;
    };
    const texts = (host: HTMLElement, selector: string): string[] =>
      [...host.querySelectorAll(selector)].map((el) => el.textContent ?? "");
    const host = render();
    const rows = [...host.querySelectorAll<HTMLElement>(".attest-research-progress__row")];
    expect([
      texts(host, ".attest-research-progress__title"),
      texts(host, ".attest-research-progress__summary"),
      texts(host, ".attest-research-progress__legend-item"),
      rows.map((row) => [
        row.querySelector(".attest-research-progress__number")!.textContent,
        row.querySelector(".attest-research-progress__chip")!.textContent,
      ]),
      texts(host, ".attest-research-progress__reason"),
      texts(host, ".attest-research-progress__note"),
      rows[1]!.querySelector<HTMLElement>(".attest-research-progress__body")!.hidden,
    ]).toEqual([
      ["Gathering sources"],
      ["1 of 3 done"],
      ["Partial: 1", "Waiting: 1", "Failed: 1"],
      [
        ["1", "Failed"],
        ["2", "Partial"],
        ["3", "Waiting"],
      ],
      ["Provider down"],
      ["Main thread", "After 1"],
      true,
    ]);
    rows[1]!.querySelector<HTMLButtonElement>(".attest-research-progress__toggle")!.click();
    expect(rows[1]!.querySelector(".attest-research-progress__body")!.textContent).toContain(
      "Found tides",
    );
    [...rows[1]!.querySelectorAll("button")]
      .find((button) => button.textContent === "Open agent details")!
      .click();
    expect(onOpenSubAgentSession).toHaveBeenCalledWith("s-2");
    const rerendered = render().querySelectorAll<HTMLElement>(".attest-research-progress__body");
    expect([...rerendered].map((body) => body.hidden)).toEqual([true, false, true]);
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Continue")!
      .click();
    expect(onTurn).toHaveBeenCalledWith(
      { type: "continue", researchId: state.researchId },
      "Continue the research",
    );
  });

  it("folds the gathered items under the stages that follow and shows the live step with its clock", () => {
    const pending = pendingResearch();
    const plan = { ...pending.plan!, approvedAt: "2026-01-01T00:00:00.000Z" };
    const hypothesis = {
      hypothesisId: "h-1",
      revision: 1,
      previousRevision: null,
      branchId: "branch-1",
      claim: "Moon drives tides",
      alternative: "Wind",
      prediction: "Lunar cycle",
      disconfirmation: "No cycle",
      status: "supported" as const,
      observationIds: [],
    };
    const state = {
      ...pending,
      phase: "verifying" as const,
      pending: null,
      plan,
      executions: initialExecutions(plan).map((execution, index) => ({
        ...execution,
        state: index === 0 ? ("completed" as const) : ("failed" as const),
      })),
      discovery: {
        hypotheses: [hypothesis],
        tests: [],
        observations: [],
        cycles: [],
        notes: [],
        executions: [],
        omissions: [],
      },
    };
    const activity = {
      researchId: state.researchId,
      at: 100_000,
      stage: "verification" as const,
      stages: {
        hypotheses: { startedAt: 0, endedAt: 60_000 },
        verification: { startedAt: 60_000 },
      },
      step: {
        kind: "checking" as const,
        batch: 1,
        batches: 2,
        from: 3,
        to: 4,
        tally: { supported: 1, conflicted: 1, unverified: 0, total: 4 },
      },
      budget: { activeMs: 5 * 60_000, modelRounds: 7, branchAttempts: 2 },
    };
    const context = {
      view: { status: "ready" as const, active: state, history: [] },
      t,
      sentTurns: new Set<string>(),
      expandedBranches: new Set<string>(),
      running: true,
      activity,
      now: () => 161_000,
      onTurn: vi.fn(),
    };
    const render = (): HTMLElement => {
      const host = document.createElement("div");
      renderResearchCard(
        host,
        { researchId: state.researchId, artifact: "plan", revision: state.revision },
        context,
      );
      return host;
    };
    const texts = (host: HTMLElement, selector: string): string[] =>
      [...host.querySelectorAll(selector)].map((el) => el.textContent ?? "");
    const host = render();
    expect([
      texts(host, ".attest-research-progress__title"),
      texts(host, ".attest-research-progress__summary"),
      texts(host, ".attest-research-stages__gathered-text"),
      [...host.querySelectorAll(".attest-research-stage")].map((el) => el.className),
      texts(host, ".attest-research-stage__time"),
      texts(host, ".attest-research-stage__now"),
      texts(host, ".attest-research-stage__sub"),
      texts(host, ".attest-research-claims__legend-item"),
      texts(host, ".attest-research-progress__budget"),
      host.querySelector<HTMLElement>(".attest-research-stages__rows")!.hidden,
    ]).toEqual([
      ["Research · stage 2 of 4"],
      ["5 of 60 min"],
      ["Gathered 1 of 2 plan items"],
      [
        "attest-research-stage is-done",
        "attest-research-stage is-running is-live",
        "attest-research-stage is-pending",
        "attest-research-stage is-pending",
      ],
      ["1:00", "1:41", "—", "—"],
      ["Checking claims 3–4 against quotes · batch 1 of 2"],
      [
        "Hypotheses: 1 · supported: 1 · disconfirmed: 0",
        "Extracted claims: 4",
        "Up to 2 extra searches for items with disputed or uncovered claims",
      ],
      ["Supported: 1", "Conflicting: 1", "Unverified: 0", "Left: 2"],
      ["Rounds 7 of 280 · attempts 2 of 16 · 5 of 60 min"],
      true,
    ]);
    tickStageClocks(host, 200_000);
    expect(texts(host, ".attest-research-stage__time")[1]).toBe("2:20");
    const toggle = host.querySelector<HTMLButtonElement>(
      ".attest-research-stages__gathered button",
    )!;
    toggle.click();
    expect([
      toggle.textContent,
      host.querySelectorAll(".attest-research-progress__row").length,
    ]).toEqual(["Hide", 2]);
    expect(render().querySelector<HTMLElement>(".attest-research-stages__rows")!.hidden).toBe(
      false,
    );
  });

  it("lists the tests, follow-ups and report sections of the running stages", () => {
    const pending = pendingResearch();
    const plan = {
      ...pending.plan!,
      approvedAt: "2026-01-01T00:00:00.000Z",
      reportOutline: ["Summary", "Risks"],
    };
    const hypothesis = (id: string, claim: string) => ({
      hypothesisId: id,
      revision: 1,
      previousRevision: null,
      branchId: "branch-1",
      claim,
      alternative: "Wind",
      prediction: "Lunar cycle",
      disconfirmation: "No cycle",
      status: "untested" as const,
      observationIds: [],
    });
    const test = (id: string) => ({
      testId: `t-${id}`,
      hypothesisId: id,
      hypothesisRevision: 1,
      kind: "literature-check" as const,
      method: "Search",
      status: "proposed" as const,
    });
    const [first] = initialExecutions(plan);
    const discovering = {
      ...pending,
      phase: "discovering" as const,
      pending: null,
      plan,
      discovery: {
        hypotheses: [
          hypothesis("h-1", "Moon"),
          hypothesis("h-2", "Sun"),
          hypothesis("h-3", "Wind"),
        ],
        tests: [test("h-1"), test("h-2"), test("h-3")],
        observations: [],
        cycles: [{ ordinal: 1, workIds: [], decision: "continue" as const, reason: "Go" }],
        notes: [],
        executions: [
          { ...first!, workId: "t-h-1", state: "running" as const },
          { ...first!, workId: "t-h-2", state: "completed" as const },
        ],
        omissions: [],
      },
    };
    const writing = {
      ...discovering,
      phase: "synthesizing" as const,
      verification: {
        claims: [],
        assessments: [],
        coverage: [],
        verifiedWorks: [],
        followUps: [{ ...first!, workId: "f-1", state: "completed" as const }],
        followUpsUsed: 1,
      },
    };
    const render = (state: typeof discovering | typeof writing, step: unknown): HTMLElement => {
      const host = document.createElement("div");
      renderResearchCard(
        host,
        { researchId: state.researchId, artifact: "plan", revision: state.revision },
        {
          view: { status: "ready", active: state, history: [] },
          t,
          sentTurns: new Set(),
          running: true,
          activity: {
            researchId: state.researchId,
            at: 0,
            stage: state === writing ? "writing" : "hypotheses",
            stages: {},
            step: step as never,
            budget: { activeMs: 0, modelRounds: 0, branchAttempts: 0 },
          },
          onTurn: vi.fn(),
        },
      );
      return host;
    };
    const items = (host: HTMLElement): string[] =>
      [...host.querySelectorAll(".attest-research-stage__item")].map(
        (el) => `${el.className.replace("attest-research-stage__item ", "")} ${el.textContent}`,
      );
    expect(items(render(discovering, { kind: "testing", cycle: 1 }))).toEqual([
      "is-searching Searching the literatureMoon",
      "is-judging Judging the resultSun",
      "is-queued QueuedWind",
    ]);
    const host = render(writing, { kind: "writing", words: 40, headings: ["Summary"] });
    expect([
      items(host),
      [...host.querySelectorAll(".attest-research-stage__now")].map((el) => el.textContent),
    ]).toEqual([
      ["is-done DoneBranch 1", "is-current Summary", "is-pending Risks"],
      ["Writing “Summary” · 40 words"],
    ]);
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

  it("renders a finished partial report once and links earlier turns to it", () => {
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
        missingBranches: [{ branchId: "branch-2", reason: "Time", title: "Tides" }],
        stopReason: "The active execution time limit was reached.",
        createdAt: "2026-01-01T00:00:00.000Z",
        verification: {
          supported: 2,
          conflicted: 1,
          unsupported: 1,
          unresolved: 2,
          uncoveredObjectives: ["Neap tides", "Spring tides", "Storm surges", "Seiches"],
        },
        scale: { objectives: 5, activeMs: 125_000, activeLimitMs: 1_800_000 },
      },
    };
    const transcript = document.createElement("div");
    transcript.className = "attest-chat__transcript";
    const context = {
      view: { status: "ready" as const, active: null, history: [entry] },
      t,
      sentTurns: new Set<string>(),
      latestRevisions: new Map([["research-1", 9]]),
      onTurn: vi.fn(),
    };
    const card = (revision: number): HTMLElement => {
      const host = transcript.createDiv();
      renderResearchCard(host, { researchId: "research-1", artifact: "plan", revision }, context);
      return host;
    };
    const earlier = card(4);
    const final = card(9);
    const texts = (selector: string): string[] =>
      [...final.querySelectorAll(selector)].map((el) => el.textContent ?? "");

    expect([
      texts(".attest-research-report__chip"),
      texts(".attest-research-report__reason"),
      texts(".attest-research-report__stat"),
      texts(".attest-research-report__missing"),
      texts(".attest-research-claims__legend-item"),
      texts(".attest-research-report__warning-title"),
      [...final.querySelectorAll<HTMLElement>(".attest-research-report__warning li")].map(
        (item) => item.hidden,
      ),
      earlier.querySelector(".attest-research-report"),
    ]).toEqual([
      ["Partial"],
      ["The active execution time limit was reached. · 2 of 30 min"],
      ["1 / 2plan items gathered", "2 / 6claims supported", "1 / 5objectives covered"],
      ["Not gathered: Tides — Time"],
      ["Supported: 2", "Conflicting: 1", "Unverified: 3"],
      ["Objectives not covered: 4"],
      [false, false, false, true],
      null,
    ]);
    final.querySelector<HTMLButtonElement>(".attest-research-report__warning button")!.click();
    expect(final.querySelectorAll(".attest-research-report__warning li[hidden]")).toHaveLength(0);
    const report = final.querySelector<HTMLElement>(".attest-research-report")!;
    report.scrollIntoView = vi.fn();
    [...earlier.querySelectorAll("button")]
      .find((button) => button.textContent === "Go to report")!
      .click();
    expect(report.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
