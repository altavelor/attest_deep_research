// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, Component, View, takeNotices } from "../../support/obsidian";
import type { WorkspaceLeaf as ObsidianWorkspaceLeaf } from "obsidian";

import {
  ATTEST_CHAT_VIEW_TYPE,
  AttestChatView,
  type AttestChatViewServices,
} from "@apps/obsidian/ui/chat/AttestChatView";
import { createTranslator } from "@adapters/i18n";
import type { SubAgentInspectionDetail } from "@application/contracts/subAgentInspection";
import { eventually, settle } from "../../support/async";
import { createTestSessionManager } from "../../support/chatSessions";
import {
  advanceTime,
  installObsidianDomHelpers,
  pendingTimerCount,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../support/domHarness";
import {
  FakeInspectionPort,
  inspectionSnapshot,
  runSummary,
  sessionCard,
  workItem,
} from "../../support/subAgentInspection";
import { AT, deferred } from "../../support/subAgentSessions";

function createHarness() {
  const { manager, repository } = createTestSessionManager();
  const ports: FakeInspectionPort[] = [];
  const portBySession = new Map<string, FakeInspectionPort>();
  const state = { debug: false, prepare: (_port: FakeInspectionPort) => {} };
  vi.spyOn(manager, "getSubAgentInspection").mockImplementation((sessionId) => {
    let port = portBySession.get(sessionId);
    if (!port) {
      port = new FakeInspectionPort();
      state.prepare(port);
      portBySession.set(sessionId, port);
      ports.push(port);
    }
    return port;
  });
  const app = new App();
  const services: AttestChatViewServices = {
    createResearchService: () => {
      throw new Error("The view must not create a research service.");
    },
    isWebSearchEnabled: () => true,
    getChatModel: () => "model",
    getAvailableChatModels: () => ["model"],
    getChatModelProfiles: () => [{ id: "model", name: "Model", supportsAgentMode: true }],
    getDefaultChatModelProfileId: () => "model",
    getDefaultIndexProfileId: () => "index",
    getDefaultSearchMode: () => "webOnly",
    getDefaultResearchMode: () => "instant",
    getIndexProfiles: () => [],
    getIndexSearchEmbedderWarning: () => undefined,
    openIndexSettings: () => {},
    searchIndex: async () => ({ chunks: [] }),
    sessions: manager,
    listSavedChats: () => repository.listChats(),
    loadSavedChat: (id) => repository.loadChat(id),
    renameSavedChat: async () => {},
    setSavedChatFavorite: async () => {},
    getTranslator: () => createTranslator("en"),
    isDebugMode: () => state.debug,
    shouldIncludeActiveFileContext: () => false,
  };
  app.workspace.registerViewFactory(
    ATTEST_CHAT_VIEW_TYPE,
    (leaf) =>
      new AttestChatView(leaf as unknown as ObsidianWorkspaceLeaf, services) as unknown as View,
  );
  return { app, manager, repository, state, ports, portOf: (id: string) => portBySession.get(id)! };
}

type Harness = ReturnType<typeof createHarness>;

async function openView(harness: Harness): Promise<AttestChatView> {
  const leaf = harness.app.workspace.createLeaf();
  await leaf.setViewState({ type: ATTEST_CHAT_VIEW_TYPE, active: true });
  await settle();
  return leaf.view as unknown as AttestChatView;
}

function agentsButton(view: AttestChatView): HTMLButtonElement | null {
  return view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__agents-button");
}

function modals(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(".attest-sub-agents-modal")];
}

function modalText(): string {
  return modals()[0]?.textContent ?? "";
}

function cards(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll<HTMLButtonElement>(".attest-sub-agents__card")];
}

function clickByText(text: string): void {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === text,
  );
  if (!button) throw new Error(`No button "${text}".`);
  button.click();
}

function sectionHeaders(): HTMLButtonElement[] {
  return [
    ...document.body.querySelectorAll<HTMLButtonElement>(".attest-sub-agents__section-header"),
  ];
}

function runningDetail(): SubAgentInspectionDetail {
  const card = sessionCard("s1", {
    status: "running",
    description: "Find primary <b>sources</b>",
    canStop: true,
    controlRunId: "run-2",
  });
  return {
    card,
    runs: [
      runSummary("run-1", "s1", {
        model: { profileId: "p", providerId: "x", modelId: "old", label: "Old Model" },
      }),
      runSummary("run-2", "s1", { status: "running", model: card.model! }),
    ],
    selectedRunId: "run-2",
    initialPrompts: [
      {
        runId: "run-1",
        capturedAt: AT,
        state: "evicted",
        messages: [],
        redacted: false,
        truncated: false,
      },
      {
        runId: "run-2",
        capturedAt: AT,
        state: "captured",
        messages: [
          { role: "system", content: "You are a sub-agent. key: [redacted]" },
          { role: "user", content: `<img src=x onerror=alert(1)>${"long ".repeat(500)}` },
        ],
        redacted: true,
        truncated: true,
      },
    ],
    lifetime: [workItem("w1", "run-1", 1), workItem("w2", "run-2", 2, { status: "pending" })],
  };
}

async function openDetail(harness: Harness, detail: SubAgentInspectionDetail) {
  const view = await openView(harness);
  const port = harness.ports[0];
  port.emit(inspectionSnapshot([detail.card]), [detail]);
  await settle();
  agentsButton(view)!.click();
  await settle();
  cards()[0].click();
  await settle();
  return { view, port };
}

beforeEach(() => {
  installObsidianDomHelpers();
  takeNotices();
});

afterEach(() => {
  restoreDomTimers();
  resetDom();
  vi.restoreAllMocks();
});

describe("sub-agent sessions button and modal", () => {
  it("S1 shows the agents button only for a chat with runs, right after the mode selector", async () => {
    const harness = createHarness();
    const firstRead = deferred<ReturnType<typeof inspectionSnapshot>>();
    harness.state.prepare = (port) => {
      port.snapshotReply = () => firstRead.promise;
    };
    const view = await openView(harness);
    const port = harness.ports[0];
    expect(agentsButton(view)).toBeNull();

    port.emit(inspectionSnapshot([sessionCard("s1", { status: "queued" })]));
    await settle();
    const button = agentsButton(view)!;
    expect(
      button.previousElementSibling?.querySelector(".attest-chat__dropdown--research-mode"),
    ).not.toBeNull();
    expect(button.nextElementSibling?.classList.contains("attest-chat__context-indicator")).toBe(
      true,
    );
    const buttonClass = button.className;
    const content = button.querySelector(".attest-chat__agents-button-content")!;
    expect([content.textContent, content.classList.contains("is-active")]).toEqual(["0", false]);
    expect(button.getAttribute("aria-label")).toBe("Sub-agents: 0 running. Open agent sessions");

    const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input")!;
    textarea.value = "half written";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    const running = Array.from({ length: 12 }, (_, i) =>
      sessionCard(`r${i}`, { status: "running" }),
    );
    port.emit(
      inspectionSnapshot([...running, sessionCard("s2", { status: "importing" })], { revision: 2 }),
    );
    await settle();
    expect([content.textContent, content.classList.contains("is-active")]).toEqual(["12", true]);
    expect(button.className).toBe(buttonClass);
    expect(button.getAttribute("title")).toBe("Sub-agents · 12 running");
    port.emit(inspectionSnapshot([], { revision: 1, hasAgentRuns: true }));
    await settle();
    expect(content.textContent).toBe("12");
    expect(textarea.value).toBe("half written");
    expect(document.activeElement).toBe(textarea);

    port.emit(inspectionSnapshot([sessionCard("s1", { status: "failed" })], { revision: 3 }));
    await settle();
    expect([content.textContent, content.classList.contains("is-active")]).toEqual(["0", false]);
    expect(agentsButton(view)).toBe(button);

    const nextRead = deferred<ReturnType<typeof inspectionSnapshot>>();
    harness.state.prepare = (next) => {
      next.snapshotReply = () => nextRead.promise;
    };
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label^="New chat"]')!.click();
    await settle();
    expect(agentsButton(view)).toBeNull();
    firstRead.resolve(
      inspectionSnapshot([sessionCard("late", { status: "running" })], { revision: 9 }),
    );
    port.emit(inspectionSnapshot([sessionCard("late", { status: "running" })], { revision: 4 }));
    await settle();
    expect(agentsButton(view)).toBeNull();
    harness.ports
      .at(-1)!
      .emit(
        inspectionSnapshot([
          sessionCard("n1", { status: "running" }),
          sessionCard("n2", { status: "running" }),
        ]),
      );
    nextRead.reject(new Error("store unreadable"));
    await settle();
    expect(agentsButton(view)?.textContent).toBe("2");
  });

  it("S2 lists the chat's sessions with loading, error, retry, empty and paged history states", async () => {
    const harness = createHarness();
    const view = await openView(harness);
    const port = harness.ports[0];
    port.emit(inspectionSnapshot([sessionCard("s0")]));
    await settle();
    const read = deferred<ReturnType<typeof inspectionSnapshot>>();
    port.snapshotReply = () => read.promise;
    agentsButton(view)!.click();
    await settle();
    expect(modals()[0].querySelector('[role="status"]')?.textContent).toBe(
      "Loading agent sessions…",
    );

    read.reject(new Error("store unreadable"));
    await settle();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load agent sessions",
    );
    port.snapshotReply = async () => inspectionSnapshot([], { hasAgentRuns: true, revision: 2 });
    clickByText("Retry");
    await settle();
    expect(modalText()).toContain("No agent sessions to show");

    const history = Array.from({ length: 120 }, (_, i) =>
      sessionCard(`h${i}`, { status: i === 0 ? "queued" : "ready" }),
    );
    history[1] = sessionCard("h1", {
      usage: {
        requestCount: 1,
        modelRounds: 1,
        toolCalls: 0,
        durationMs: 0,
        source: "unavailable",
      },
    });
    history[2] = sessionCard("h2", { usageIncomplete: true, description: "x".repeat(400) });
    const running = [
      sessionCard("run-a", { status: "running" }),
      sessionCard("run-b", { status: "running" }),
    ];
    port.emit(inspectionSnapshot([...running, ...history], { revision: 3 }));
    await settle();
    const groups = [...document.body.querySelectorAll(".attest-sub-agents__group")].map(
      (el) => el.textContent,
    );
    expect(groups).toEqual(["Running · 2", "Queued and history · 120"]);
    expect(cards()).toHaveLength(50);
    expect(
      cards()
        .slice(0, 2)
        .map((card) => card.dataset.sessionId),
    ).toEqual(["run-a", "run-b"]);
    const metrics = (index: number) =>
      [...cards()[index].querySelectorAll(".attest-sub-agents__card-metrics > span")].map(
        (el) => el.textContent,
      );
    expect(metrics(2)).toEqual(["Queued", "1m 05s", "Model One", "1.2k tokens"]);
    expect(metrics(3)[3]).toBe("No data");
    expect(metrics(4)[3]).toBe("1.2k · partial");
    expect(
      cards()[4].querySelector(".attest-sub-agents__card-description")?.getAttribute("title"),
    ).toBe("x".repeat(400));
    expect(
      cards()[4].querySelector(".attest-sub-agents__card-description")?.getAttribute("dir"),
    ).toBe("auto");
    port.emit(inspectionSnapshot([], { revision: 2, hasAgentRuns: true }));
    expect(cards()).toHaveLength(50);

    clickByText("Show more (72 older)");
    expect(cards()).toHaveLength(100);
    expect(modalText()).toContain("Show more (22 older)");
    expect(modals()).toHaveLength(1);
  });

  it("S3 opens details in the same modal, keeps sections and run choice, and returns to the list", async () => {
    const harness = createHarness();
    const detail = runningDetail();
    const saved = await harness.repository.saveChat({
      messages: [{ id: "m-user", role: "user", content: "Compare dates", createdAt: AT }],
      lastAnswer: null,
      attachedContextPaths: [],
      chatSettings: { chatModelProfileId: "model", searchMode: "webOnly" },
      subAgentNotices: [
        {
          eventKey: "notice:s1:created",
          parentRunId: "parent-1",
          description: "Find primary sources",
          createdAt: AT,
          sessionId: "s1",
          runId: "run-2",
          sequence: 5,
          kind: "created",
        },
      ],
      timelineSequence: 5,
    });
    harness.state.prepare = (port) => {
      const single = sessionCard("s2", { usageIncomplete: true });
      port.current = inspectionSnapshot([detail.card, single, sessionCard("s3")]);
      port.details.set("s1", detail);
      port.details.set("s2", { ...detail, card: single, runs: [detail.runs[0]] });
    };
    const view = await openView(harness);
    view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__icon-button")[0].click();
    await settle();
    [...view.contentEl.querySelectorAll<HTMLElement>(".attest-chat__saved-row")]
      .find((row) => row.textContent?.includes(saved.title))!
      .querySelector<HTMLElement>(".attest-chat__saved-open, .attest-chat__saved-title")!
      .click();
    await settle();
    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__agent-open")!.click();
    await settle();
    expect(modals()).toHaveLength(1);
    expect(document.body.querySelector(".attest-sub-agents__description")?.textContent).toBe(
      "Find primary <b>sources</b>",
    );
    expect(document.body.querySelector(".attest-sub-agents__description b")).toBeNull();
    expect(
      document.body.querySelector(".attest-sub-agents__description")?.getAttribute("dir"),
    ).toBe("auto");
    expect(sectionHeaders().map((header) => header.getAttribute("aria-expanded"))).toEqual([
      "false",
      "false",
    ]);
    expect(modalText()).toContain("Models changed");

    const select = document.body.querySelector<HTMLSelectElement>(
      ".attest-sub-agents__run-select",
    )!;
    expect(select.value).toBe("run-2");
    sectionHeaders()[0].click();
    const prompt = () => document.body.querySelector(".attest-sub-agents__section-body")!;
    expect(
      [...prompt().querySelectorAll(".attest-sub-agents__prompt-role")].map((el) => el.textContent),
    ).toEqual(["System", "User"]);
    expect(prompt().querySelector("img")).toBeNull();
    expect(prompt().textContent).toContain("Truncated — the rest was not stored");
    const port = harness.ports.at(-1)!;
    const promptList = prompt().querySelector<HTMLElement>(".attest-sub-agents__prompt")!;
    promptList.scrollTop = 40;
    select.focus();
    port.emit(inspectionSnapshot([{ ...detail.card, elapsedMs: 80_000 }], { revision: 2 }));
    await settle();
    expect(prompt().querySelector(".attest-sub-agents__prompt")).toBe(promptList);
    expect(promptList.scrollTop).toBe(40);
    expect(document.activeElement).toBe(select);
    select.value = "run-1";
    select.dispatchEvent(new Event("change"));
    expect(prompt().textContent).toBe("The initial prompt was removed to keep the chat small.");

    port.emit(
      inspectionSnapshot(
        [{ ...detail.card, elapsedMs: 90_000 }, sessionCard("s2"), sessionCard("s3")],
        {
          revision: 3,
        },
      ),
    );
    await settle();
    expect(sectionHeaders().map((header) => header.getAttribute("aria-expanded"))).toEqual([
      "true",
      "false",
    ]);
    expect(
      document.body.querySelector<HTMLSelectElement>(".attest-sub-agents__run-select")!.value,
    ).toBe("run-1");
    document.body.querySelector<HTMLSelectElement>(".attest-sub-agents__run-select")!.focus();
    port.emit(
      inspectionSnapshot([detail.card, sessionCard("s2"), sessionCard("s3")], { revision: 4 }),
      [{ ...detail, runs: [detail.runs[1]] }],
    );
    await settle();
    expect(document.activeElement).toBe(
      document.body.querySelector(".attest-sub-agents__description"),
    );
    port.details.set("s1", detail);

    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__agent-open")!.click();
    await settle();
    expect(modals()).toHaveLength(1);
    clickByText("Back to agents");
    await settle();
    expect(cards().map((card) => card.dataset.sessionId)).toEqual(["s1", "s2", "s3"]);
    expect(document.activeElement).toBe(cards()[0]);
    const list = document.body.querySelector<HTMLElement>(".attest-sub-agents")!;
    list.scrollTop = 30;
    cards()[1].click();
    await settle();
    list.scrollTop = 0;
    expect(
      document.body.querySelector(".attest-sub-agents__run-row")?.classList.contains("is-hidden"),
    ).toBe(true);
    expect(document.body.querySelector(".attest-sub-agents__metrics")?.textContent).toContain(
      "Partial",
    );
    clickByText("Back to agents");
    expect(list.scrollTop).toBe(30);
    cards()[2].click();
    await settle();
    expect(modalText()).toContain("This agent session is not part of this chat.");

    view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__icon-button")[0].click();
    await settle();
    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__saved-action--delete")!.click();
    await settle();
    expect([modals().length, port.listeners.size]).toEqual([0, 0]);
  });

  it("S4 renders the child timeline with the shared renderer and drops debug payloads on demand", async () => {
    const harness = createHarness();
    const detail = runningDetail();
    const adapter = harness.app.vault.adapter as {
      write(path: string, data: string): Promise<void>;
    };
    const write = vi.spyOn(adapter, "write");
    const { view, port } = await openDetail(harness, detail);
    sectionHeaders()[1].click();
    const timeline = () => document.body.querySelector(".attest-sub-agents__timeline")!;
    expect(timeline().classList.contains("attest-sub-agents__work-gutter")).toBe(true);
    expect(timeline().querySelector(".attest-chat__workflow-node--pending")).not.toBeNull();
    expect(timeline().querySelector(".attest-chat__workflow-separator")?.textContent).toBe(
      "Run 2 · attempt 1",
    );
    expect(timeline().querySelector(".attest-chat__tool-cell")).toBeNull();

    const result = '{"value":"<script>steal()</script> token: [redacted]"}';
    const done = {
      ...detail,
      lifetime: [
        workItem("w1", "run-1", 1, { payloadState: "evicted" }),
        workItem("w2", "run-2", 2, { args: { query: "<b>q</b>" }, resultJson: result }),
      ],
    };
    harness.state.debug = true;
    view.redisplay();
    port.emit(inspectionSnapshot([detail.card], { revision: 2 }), [done]);
    await settle();
    expect(timeline().querySelector(".attest-chat__workflow-node--pending")).toBeNull();
    expect(timeline().textContent).toContain("Payload was evicted from memory.");
    timeline().querySelectorAll<HTMLElement>(".attest-chat__tool-cell--out")[0].click();
    const viewer = () => timeline().querySelector(".attest-chat__tool-output-viewer");
    expect(viewer()?.textContent).toContain("<script>steal()</script> token: [redacted]");
    expect(timeline().querySelector("script, b")).toBeNull();
    const outCell = timeline().querySelectorAll<HTMLElement>(".attest-chat__tool-cell--out")[0];
    outCell.focus();
    port.emit(inspectionSnapshot([detail.card], { revision: 3 }), [done]);
    await settle();
    expect(viewer()).not.toBeNull();
    expect(document.activeElement).toBe(outCell);
    const changed = { ...done, lifetime: [...done.lifetime, workItem("w3", "run-2", 3)] };
    port.emit(inspectionSnapshot([detail.card], { revision: 4 }), [changed]);
    await settle();
    expect((document.activeElement as HTMLElement).dataset.toolCellId).toBe(
      outCell.dataset.toolCellId,
    );
    expect(document.activeElement).not.toBe(outCell);
    timeline().querySelector<HTMLElement>(".attest-chat__tool-output-viewer-close")!.focus();
    port.emit(inspectionSnapshot([detail.card], { revision: 5 }), [done]);
    await settle();
    expect(document.activeElement?.className).toBe("attest-chat__tool-output-viewer-close");

    harness.state.debug = false;
    view.redisplay();
    expect(viewer()).toBeNull();
    expect(timeline().querySelector(".attest-chat__tool-cell")).toBeNull();
    expect(timeline().textContent).not.toContain("steal()");
    expect(write).not.toHaveBeenCalled();
    const released = vi.spyOn(Component.prototype, "removeChild");
    modals()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(released).toHaveBeenCalledTimes(1);
  });

  it("S5 stops only the run the user saw and reports stale, failed and late results", async () => {
    const harness = createHarness();
    const detail = runningDetail();
    const { port } = await openDetail(harness, detail);
    const ack = deferred<"stopped" | "already-terminal" | "stale">();
    port.stopReply = () => ack.promise;
    const firstStop = document.body.querySelector<HTMLButtonElement>(
      ".attest-sub-agents__stop-button",
    )!;
    firstStop.focus();
    firstStop.click();
    port.emit(inspectionSnapshot([{ ...detail.card, controlRunId: "run-3" }], { revision: 2 }), [
      {
        ...detail,
        card: { ...detail.card, controlRunId: "run-3" },
        runs: [...detail.runs, runSummary("run-3", "s1")],
      },
    ]);
    await settle();
    const stopButton = () =>
      document.body.querySelector<HTMLButtonElement>(".attest-sub-agents__stop-button")!;
    expect([
      stopButton().textContent,
      stopButton().getAttribute("aria-disabled"),
      stopButton().getAttribute("aria-busy"),
    ]).toEqual(["Stopping…", "true", "true"]);
    expect(document.activeElement).toBe(stopButton());
    stopButton().click();
    expect(port.stopCalls).toEqual([["s1", "run-2"]]);

    ack.resolve("stale");
    await settle();
    expect(document.activeElement).toBe(stopButton());
    expect(modalText()).toContain("New run 3 started; nothing was stopped.");
    port.stopReply = () => Promise.reject(new Error("disk full"));
    clickByText("Stop agent");
    await settle();
    expect(
      document.body.querySelector(".attest-sub-agents__stop [role='alert']")?.textContent,
    ).toBe("Stop not saved yet. The agent is halted.");
    port.stopReply = async () => "already-terminal";
    port.details.set("s1", {
      ...detail,
      card: { ...detail.card, status: "interrupted", canStop: false },
    });
    clickByText("Retry stop");
    await settle();
    expect(port.stopCalls.map(([, runId]) => runId)).toEqual(["run-2", "run-3", "run-3"]);
    expect(document.body.querySelector(".attest-sub-agents__metrics")?.textContent).toContain(
      "Interrupted",
    );
    expect(document.body.querySelector(".attest-sub-agents__stop-button")).toBeNull();

    port.details.set("s1", detail);
    port.emit(inspectionSnapshot([detail.card], { revision: 4 }));
    await settle();
    const away = deferred<"stopped">();
    port.stopReply = () => away.promise;
    const stop = stopButton();
    stop.focus();
    port.emit(inspectionSnapshot([detail.card], { revision: 5 }));
    await settle();
    expect(document.activeElement).toBe(stop);
    stop.click();
    clickByText("Back to agents");
    away.reject(new Error("disk full"));
    await settle();
    expect(takeNotices()).toEqual([]);
    cards()[0].click();
    await settle();
    expect(modalText()).toContain("Stop not saved yet. The agent is halted.");
    const late = deferred<"stopped">();
    port.stopReply = () => late.promise;
    clickByText("Retry stop");
    modals()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    late.reject(new Error("disk full"));
    await settle();
    expect(modals()).toHaveLength(0);
    expect(takeNotices().map((notice) => notice.message)).toEqual([
      "A sub-agent stop was not saved. Open the agents to try again.",
    ]);
  });

  it("S6 releases the modal on close, chat switch and delete without stopping anything", async () => {
    useDomFakeTimers();
    const harness = createHarness();
    const detail = runningDetail();
    const { view, port } = await openDetail(harness, detail);
    sectionHeaders()[1].click();
    const before = document.body.querySelector(
      ".attest-sub-agents__metric .attest-sub-agents__numeric",
    )!;
    expect(before.textContent).toBe("1m 05s");
    expect(pendingTimerCount()).toBe(1);
    await advanceTime(2000);
    expect(before.textContent).toBe("1m 07s");
    expect(port.listeners.size).toBe(2);
    const finished = {
      ...detail,
      card: { ...detail.card, status: "ready" as const, canStop: false },
    };
    port.emit(inspectionSnapshot([finished.card], { revision: 2 }), [finished]);
    await settle();
    await advanceTime(2000);
    sectionHeaders()[0].click();
    const frozen = document.body.querySelector(
      ".attest-sub-agents__metric .attest-sub-agents__numeric",
    )!;
    expect([pendingTimerCount(), frozen.textContent]).toEqual([0, "1m 05s"]);
    port.details.set("s1", detail);
    port.emit(inspectionSnapshot([detail.card], { revision: 3 }));
    await settle();
    expect(pendingTimerCount()).toBe(1);

    modals()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect([modals().length, port.listeners.size, pendingTimerCount()]).toEqual([0, 1, 0]);

    const nextRead = deferred<ReturnType<typeof inspectionSnapshot>>();
    harness.state.prepare = (next) => {
      next.snapshotReply = () => nextRead.promise;
    };
    const gate = deferred<void>();
    port.sessionReply = async (sessionId) => {
      await gate.promise;
      return port.details.get(sessionId) ?? null;
    };
    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__agents-button")!.click();
    await settle();
    cards()[0].click();
    view.contentEl.querySelector<HTMLButtonElement>('[aria-label^="New chat"]')!.click();
    await settle();
    gate.resolve();
    await settle();
    expect([
      modals().length,
      port.listeners.size,
      document.body.querySelector(".attest-sub-agents__detail"),
    ]).toEqual([0, 0, null]);
    expect(document.activeElement).not.toBe(view.contentEl.querySelector(".attest-chat__input"));
    const next = harness.ports.at(-1)!;
    next.current = inspectionSnapshot([sessionCard("own")]);
    nextRead.resolve(next.current);
    await settle();
    expect(document.activeElement).toBe(agentsButton(view));
    view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__agents-button")!.click();
    await settle();
    expect(cards().map((card) => card.dataset.sessionId)).toEqual(["own"]);
    expect(next.sessionCalls).toEqual([]);
    expect([port.stopCalls, next.stopCalls]).toEqual([[], []]);
    await eventually(() => expect(modals()).toHaveLength(1));
  });
  it("S7 renders another session while the first session's read is still held", async () => {
    const harness = createHarness();
    const view = await openView(harness);
    const port = harness.ports[0];
    const other = { ...runningDetail(), card: sessionCard("s2", { description: "Other task" }) };
    port.emit(inspectionSnapshot([runningDetail().card, other.card]), [runningDetail(), other]);
    await settle();
    const held = deferred<void>();
    port.sessionReply = async (sessionId) => {
      if (sessionId === "s1") await held.promise;
      return port.details.get(sessionId) ?? null;
    };
    agentsButton(view)!.click();
    await settle();
    cards()[0].click();
    await settle();
    clickByText("Back to agents");
    cards()[1].click();
    await settle();
    expect(document.body.querySelector(".attest-sub-agents__description")?.textContent).toBe(
      "Other task",
    );
    held.resolve();
    await settle();
    expect(document.body.querySelector(".attest-sub-agents__description")?.textContent).toBe(
      "Other task",
    );
    const again = deferred<void>();
    port.sessionReply = async (sessionId) => {
      await again.promise;
      return port.details.get(sessionId) ?? null;
    };
    clickByText("Back to agents");
    cards()[0].click();
    document.body.querySelector<HTMLButtonElement>(".attest-sub-agents__back")!.focus();
    again.resolve();
    await settle();
    expect(document.activeElement).toBe(
      document.body.querySelector(".attest-sub-agents__detail-top .attest-sub-agents__back"),
    );
  });

  it("S8 pages a long run of pending tool calls instead of rendering them all", async () => {
    const harness = createHarness();
    const detail = runningDetail();
    const pending = Array.from({ length: 120 }, (_, i) =>
      workItem(`p${i}`, "run-2", i + 1, { status: "pending" }),
    );
    await openDetail(harness, { ...detail, lifetime: pending });
    sectionHeaders()[1].click();
    const nodes = () => document.body.querySelectorAll(".attest-chat__workflow-node--pending");
    expect(nodes()).toHaveLength(50);
    document.body.querySelector<HTMLButtonElement>(".attest-sub-agents__more")!.focus();
    clickByText("Show more (70 more)");
    expect(nodes()).toHaveLength(100);
    expect(document.activeElement?.textContent).toBe("Show more (20 more)");
  });
});
