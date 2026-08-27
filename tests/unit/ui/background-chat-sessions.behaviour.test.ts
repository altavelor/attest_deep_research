// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App, View, WorkspaceLeaf, takeNotices } from "../../stubs/obsidian";
import type { WorkspaceLeaf as ObsidianWorkspaceLeaf } from "obsidian";

import {
  ATTEST_CHAT_VIEW_TYPE,
  AttestChatView,
  type AttestChatViewServices,
} from "@apps/obsidian/ui/chat/AttestChatView";
import { createTranslator } from "@adapters/i18n";
import type { ResearchService, ResearchStreamEvent } from "@application/use-cases/research";
import type { ResearchRequest } from "@application/contracts/research";
import type { ResearchAnswer } from "@core/answer";
import type { SavedChat, SavedChatSummary } from "@core/chat/savedChat";
import { createTestSessionManager } from "../../helpers/chatSessions";
import { installObsidianDomHelpers, resetDom, restoreDomTimers } from "../../helpers/domHarness";

interface Gate {
  emit(event: ResearchStreamEvent): void;
  end(): void;
}

function answerFor(text: string): ResearchAnswer {
  return {
    question: "Question?",
    answer: text,
    citations: [],
    followUpQuestions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createGatedService(gates: Gate[], requests: ResearchRequest[]): () => ResearchService {
  return () =>
    ({
      answer: (request: ResearchRequest) => {
        requests.push(request);
        const queue: ResearchStreamEvent[] = [];
        let notify: (() => void) | null = null;
        let ended = false;
        gates.push({
          emit: (event) => {
            queue.push(event);
            notify?.();
          },
          end: () => {
            ended = true;
            notify?.();
          },
        });
        return (async function* stream() {
          while (true) {
            while (queue.length > 0) yield queue.shift()!;
            if (ended) return;
            await new Promise<void>((resolve) => {
              notify = () => {
                notify = null;
                resolve();
              };
            });
          }
        })();
      },
    }) as unknown as ResearchService;
}

function createHarness() {
  const gates: Gate[] = [];
  const requests: ResearchRequest[] = [];
  const { manager, repository } = createTestSessionManager({
    createResearchService: createGatedService(gates, requests),
  });
  const app = new App();
  const services: AttestChatViewServices = {
    createResearchService: () => {
      throw new Error("The view must not create a research service.");
    },
    isWebSearchEnabled: () => true,
    getChatModel: () => "model",
    getAvailableChatModels: () => ["model"],
    getChatModelProfiles: () => [{ id: "model", name: "Model" }],
    getDefaultChatModelProfileId: () => "model",
    getDefaultIndexProfileId: () => "index",
    getDefaultSearchMode: () => "indexOnly",
    getDefaultResearchMode: () => "instant",
    getIndexProfiles: () => [{ id: "index", name: "Index", isIndexed: true }],
    getIndexSearchEmbedderWarning: () => undefined,
    openIndexSettings: () => {},
    searchIndex: async () => ({ chunks: [] }),
    sessions: manager,
    listSavedChats: () => repository.listChats(),
    loadSavedChat: (id) => repository.loadChat(id),
    renameSavedChat: async (id, title) => {
      await repository.renameChat(id, title);
    },
    setSavedChatFavorite: async (id, isFavorite) => {
      await repository.setChatFavorite(id, isFavorite);
    },
    getTranslator: () => createTranslator("en"),
    isDebugMode: () => false,
    shouldIncludeActiveFileContext: () => false,
  };
  app.workspace.registerViewFactory(
    ATTEST_CHAT_VIEW_TYPE,
    (leaf) =>
      new AttestChatView(leaf as unknown as ObsidianWorkspaceLeaf, services) as unknown as View,
  );

  return { app, manager, repository, services, gates, requests };
}

async function openLeaf(app: App): Promise<{ leaf: WorkspaceLeaf; view: AttestChatView }> {
  const leaf = app.workspace.createLeaf();
  await leaf.setViewState({ type: ATTEST_CHAT_VIEW_TYPE, active: true });
  return { leaf, view: leaf.view as unknown as AttestChatView };
}

async function ask(view: AttestChatView, question: string): Promise<void> {
  const input = view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input");
  input!.value = question;
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  view.contentEl
    .querySelector<HTMLFormElement>(".attest-chat__form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle();
}

function newChat(view: AttestChatView): void {
  view.contentEl.querySelector<HTMLButtonElement>('[aria-label^="New chat"]')?.click();
}

async function openHistory(view: AttestChatView): Promise<HTMLElement> {
  historyButton(view).click();
  await settle();
  return view.contentEl.querySelector<HTMLElement>(".attest-chat__history-popover")!;
}

function historyButton(view: AttestChatView): HTMLButtonElement {
  return view.contentEl.querySelectorAll<HTMLButtonElement>(".attest-chat__icon-button")[0];
}

function rowFor(popover: HTMLElement, title: string): HTMLElement {
  const row = Array.from(popover.querySelectorAll<HTMLElement>(".attest-chat__saved-row")).find(
    (candidate) =>
      candidate.querySelector(".attest-chat__saved-title")?.textContent?.includes(title) === true,
  );
  if (!row) throw new Error(`No chat row titled "${title}".`);
  return row;
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

describe("background chat sessions", () => {
  it("keeps both runs alive across a chat switch and never mixes their output", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);

    await ask(view, "First question");
    newChat(view);
    await settle();
    await ask(view, "Second question");

    harness.gates[0].emit({ type: "delta", content: "Background text" });
    harness.gates[1].emit({ type: "delta", content: "Foreground text" });
    await settle();

    expect(view.contentEl.textContent).toContain("Foreground text");
    expect(view.contentEl.textContent).not.toContain("Background text");
    expect(harness.requests[0].signal?.aborted).toBe(false);
    expect(harness.requests[1].signal?.aborted).toBe(false);
    expect(
      harness.manager.listSessions().filter((session) => session.status === "running"),
    ).toHaveLength(2);

    await leaf.detach();
  });

  it("shows a spinner and a Stop control for every non-terminal chat row", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    newChat(view);
    await settle();
    await ask(view, "Second question");

    const popover = await openHistory(view);
    const rows = popover.querySelectorAll(".attest-chat__saved-row");

    expect(rows).toHaveLength(2);
    for (const row of Array.from(rows)) {
      expect(row.querySelector(".attest-chat-session-spinner")).not.toBeNull();
      const stop = row.querySelector<HTMLButtonElement>(".attest-chat__session-stop");
      expect(stop?.disabled).toBe(false);
      expect(stop?.getAttribute("aria-label")).toContain("Stop the run in");
      expect(row.querySelector(".attest-chat__saved-action--delete")).toBeNull();
      expect(row.querySelector(".attest-chat__saved-action")).not.toBeNull();
    }

    await leaf.detach();
  });

  it("stops only the chat whose Stop control was pressed and keeps the selection", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    const backgroundSession = harness.manager.selectedSession!;
    newChat(view);
    await settle();
    await ask(view, "Second question");
    const selectedSession = harness.manager.selectedSession!;

    const popover = await openHistory(view);
    rowFor(popover, "First question")
      .querySelector<HTMLButtonElement>(".attest-chat__session-stop")!
      .click();
    harness.gates[0].end();
    await settle();

    expect(backgroundSession.status).toBe("interrupted");
    expect(selectedSession.status).toBe("running");
    expect(harness.manager.selectedSession).toBe(selectedSession);
    expect(harness.requests[1].signal?.aborted).toBe(false);

    await leaf.detach();
  });

  it("replaces the spinner of a completed background chat with a green dot", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    newChat(view);
    await settle();
    await ask(view, "Second question");

    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();

    const popover = await openHistory(view);
    const row = rowFor(popover, "First question");

    expect(row.querySelector(".attest-chat-session-spinner")).toBeNull();
    expect(row.querySelector(".attest-chat__session-dot")?.getAttribute("data-status")).toBe(
      "completed",
    );
    expect(row.querySelector(".attest-chat__session-stop")).toBeNull();

    row.querySelector<HTMLButtonElement>(".attest-chat__saved-open")!.click();
    await settle();
    const reopened = await openHistory(view);

    expect(
      rowFor(reopened, "First question").querySelector(".attest-chat__session-dot"),
    ).toBeNull();

    await leaf.detach();
  });

  it("reports running and unread counts on the Chats history button", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);

    expect(
      historyButton(view).querySelector<HTMLElement>(".attest-chat__history-activity-spinner")
        ?.classList,
    ).toContain("is-hidden");

    await ask(view, "First question");
    newChat(view);
    await settle();
    await ask(view, "Second question");
    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();

    const button = historyButton(view);
    expect(
      button.querySelector<HTMLElement>(".attest-chat__history-activity-spinner")?.classList,
    ).not.toContain("is-hidden");
    expect(
      button.querySelector<HTMLElement>(".attest-chat__history-activity-dot")?.classList,
    ).not.toContain("is-hidden");
    expect(button.getAttribute("aria-label")).toBe("Chats history — 1 running, 1 completed unread");

    await leaf.detach();
  });

  it("clears the unread marker only when the completed chat is selected", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    const completedSession = harness.manager.selectedSession!;
    newChat(view);
    await settle();
    await ask(view, "Second question");
    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();

    const popover = await openHistory(view);
    expect(completedSession.unreadCompletion).toBe(true);

    rowFor(popover, "First question")
      .querySelector<HTMLButtonElement>(".attest-chat__saved-open")!
      .click();
    await settle();

    expect(completedSession.unreadCompletion).toBe(false);
    expect((await harness.repository.loadChat(completedSession.chatId!))?.unreadCompletion).toBe(
      false,
    );

    await leaf.detach();
  });

  it("refuses a stale delete click on a chat whose run has since started", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    const session = harness.manager.selectedSession!;
    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();
    newChat(view);
    await settle();

    const popover = await openHistory(view);
    const deleteButton = rowFor(popover, "First question").querySelector<HTMLButtonElement>(
      ".attest-chat__saved-action--delete",
    )!;

    harness.manager.select(session.sessionId);
    await harness.manager.start(session.sessionId, {
      question: "Second question",
      chatHistory: [],
      appendQuestion: true,
      contextPaths: [],
      includeActiveFile: false,
      includeContextDiagnostics: false,
      modelLabel: "Model",
    });
    await settle();
    takeNotices();
    deleteButton.click();
    await settle();

    expect(await harness.repository.loadChat(session.chatId!)).not.toBeNull();
    expect(takeNotices().map((notice) => notice.message)).toContain(
      "A running chat cannot be deleted.",
    );

    await leaf.detach();
  });

  it("keeps runs alive when the tab closes and shows their progress on reopen", async () => {
    const harness = createHarness();
    const first = await openLeaf(harness.app);
    await ask(first.view, "First question");
    const session = harness.manager.selectedSession!;

    await first.leaf.detach();
    harness.gates[0].emit({ type: "delta", content: "Streamed while closed" });
    await settle();

    expect(harness.requests[0].signal?.aborted).toBe(false);
    expect(session.status).toBe("running");

    const second = await openLeaf(harness.app);
    await settle();

    expect(second.view.contentEl.textContent).toContain("Streamed while closed");
    await second.leaf.detach();
  });

  it("persists a background completion with no view attached", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    const session = harness.manager.selectedSession!;
    await leaf.detach();

    harness.gates[0].emit({ type: "complete", answer: answerFor("Done in the background") });
    harness.gates[0].end();
    await settle();

    const saved: SavedChat | null = await harness.repository.loadChat(session.chatId!);
    expect(saved?.lastRun).toMatchObject({ status: "completed" });
    expect(saved?.unreadCompletion).toBe(true);
    expect(saved?.messages.at(-1)?.content).toBe("Done in the background");
  });

  it("starts a new chat without touching the running one", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    const running = harness.manager.selectedSession!;

    newChat(view);
    await settle();

    expect(running.status).toBe("running");
    expect(harness.requests[0].signal?.aborted).toBe(false);
    expect(harness.manager.selectedSession).not.toBe(running);
    expect(view.contentEl.querySelector(".attest-chat__message")).toBeNull();

    const summaries: SavedChatSummary[] = await harness.repository.listChats();
    expect(summaries.map((summary) => summary.id)).toContain(running.chatId);

    await leaf.detach();
  });

  it("disables the composer of a running chat and turns Submit into Stop", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);

    await ask(view, "First question");

    const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input")!;
    const submit = view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__submit")!;
    expect(textarea.disabled).toBe(true);
    expect(submit.dataset.mode).toBe("stop");

    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();

    expect(view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input")!.disabled).toBe(
      false,
    );
    expect(
      view.contentEl.querySelector<HTMLButtonElement>(".attest-chat__submit")!.dataset.mode,
    ).toBe("ask");

    await leaf.detach();
  });

  it("keeps each chat's unsent draft with its own session", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");
    const firstSession = harness.manager.selectedSession!;
    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();

    const textarea = view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input")!;
    textarea.value = "unsent thought";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    newChat(view);
    await settle();
    expect(view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input")!.value).toBe(
      "",
    );

    const popover = await openHistory(view);
    rowFor(popover, "First question")
      .querySelector<HTMLButtonElement>(".attest-chat__saved-open")!
      .click();
    await settle();

    expect(harness.manager.selectedSession).toBe(firstSession);
    expect(view.contentEl.querySelector<HTMLTextAreaElement>(".attest-chat__input")!.value).toBe(
      "unsent thought",
    );

    await leaf.detach();
  });

  it("reports a failed run through a notice and the chat row", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "Failing question");
    const session = harness.manager.selectedSession!;

    harness.gates[0].emit({ type: "delta", content: "Partial" });
    await settle();
    takeNotices();
    harness.gates[0].emit(null as never);
    await settle();

    expect(session.status).toBe("failed");
    expect(takeNotices().length).toBeGreaterThan(0);

    const popover = await openHistory(view);
    expect(
      rowFor(popover, "Failing question")
        .querySelector(".attest-chat__session-dot")
        ?.getAttribute("data-status"),
    ).toBe("failed");

    await leaf.detach();
  });

  it("clears the progress label once the run reaches a terminal state", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "First question");

    harness.gates[0].emit({ type: "status", message: "Searching the index" });
    await settle();
    const progress = view.contentEl.querySelector<HTMLElement>(".attest-chat__progress-status")!;
    expect(progress.textContent).toBe("Searching the index");

    harness.gates[0].emit({ type: "complete", answer: answerFor("Done") });
    harness.gates[0].end();
    await settle();

    expect(
      view.contentEl.querySelector<HTMLElement>(".attest-chat__progress-status")!.textContent,
    ).toBe("");

    await leaf.detach();
  });

  it("names the chat when a background run fails", async () => {
    const harness = createHarness();
    const { leaf, view } = await openLeaf(harness.app);
    await ask(view, "Background question");
    newChat(view);
    await settle();
    await ask(view, "Foreground question");
    takeNotices();

    harness.gates[0].emit(null as never);
    await settle();

    expect(
      takeNotices()
        .map((notice) => notice.message)
        .join("\n"),
    ).toContain("Background question:");

    await leaf.detach();
  });
});
