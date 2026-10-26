// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";

import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import {
  renderChatTranscript,
  type ChatTranscriptOptions,
} from "@apps/obsidian/ui/chat/ChatTranscript";
import type { ChatRunRequest } from "@application/use-cases/chat";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { settle } from "../../support/async";
import {
  createTestSessionManager,
  fakeChildHosts,
  gatedResearch,
} from "../../support/chatSessions";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { MemoryFileSystem } from "../../support/memoryFileSystem";

const AT = "2026-10-26T10:00:00.000Z";
const settings: SavedChatSettings = {
  chatModelProfileId: "model",
  searchMode: "webOnly",
  researchMode: "thinking",
};
const NOTICE_KINDS = [
  ["created", "chat.agent.notice.created", "bot", true],
  ["queued", "chat.agent.notice.queued", "bot", true],
  ["finished", "chat.agent.notice.finished", "check", true],
  ["partial", "chat.agent.notice.partial", "alert-triangle", true],
  ["failed", "chat.agent.notice.failed", "x", true],
  ["stopped", "chat.agent.notice.stopped", "x", true],
  ["interrupted", "chat.agent.notice.interrupted", "x", true],
  ["import-failed", "chat.agent.notice.import-failed", "alert-triangle", true],
  ["not-started", "chat.agent.notice.not-started", "alert-triangle", true],
  ["closed", "chat.agent.notice.closed", "x", false],
  ["batch", "chat.agent.notice.batch", "layers", true],
] as const;

function notice(kind: string, sequence: number) {
  return {
    eventKey: `notice:chat-legacy:p1:s1:r1:${kind}`,
    parentRunId: "p1",
    description: "Find primary sources",
    createdAt: AT,
    sessionId: kind === "closed" ? null : "s1",
    runId: kind === "closed" ? null : "r1",
    sequence,
    kind,
    ...(kind === "finished"
      ? { replyExcerpt: "See [x](javascript:alert(1)) <b>bold</b> [source-1]" }
      : {}),
    ...(kind === "batch" ? { batch: { total: 3, done: 1, running: 1, failed: 1 } } : {}),
    ...(kind === "closed" ? { closedCount: 2 } : {}),
  };
}

function legacyChatFile(): string {
  const dispatch = {
    eventKey: "dispatch:chat-legacy:p1:s1:r1",
    sessionId: "s1",
    runId: "r1",
    parentRunId: "p1",
    body: "Find primary sources for the IPO date",
    createdAt: AT,
    commandKind: "initial",
    attempt: 1,
    sequence: 3,
  };
  return JSON.stringify({
    schemaVersion: 4,
    id: "chat-legacy",
    title: "Legacy",
    createdAt: AT,
    updatedAt: AT,
    messages: [
      { id: "m-user", role: "user", content: "Compare the dates", createdAt: AT },
      {
        id: "m-answer",
        role: "assistant",
        content: "Answer [source-1]",
        createdAt: AT,
        researchProgress: {
          phase: "complete",
          disclosure: "auto",
          view: "expanded",
          reasoning: { phase: "complete", segments: [] },
          checkpoints: [],
          chain: [
            {
              kind: "tool-call",
              id: "own",
              name: "search_web",
              label: "Own search",
              status: "complete",
            },
            {
              kind: "tool-call",
              id: "agent",
              name: "run_subagent",
              label: "Delegated research",
              status: "complete",
              args: { task: "Legacy task" },
              resultJson: '{"answer":"Legacy child answer"}',
              children: [
                {
                  kind: "tool-call",
                  id: "child",
                  name: "fetch_web_page",
                  label: "Child fetch",
                  status: "complete",
                },
              ],
            },
          ],
        },
      },
    ],
    lastAnswer: null,
    attachedContextPaths: [],
    chatSettings: settings,
    sourceRegistry: { sources: [] },
    unreadCompletion: false,
    subAgentDispatches: [dispatch, { ...dispatch, body: "Duplicate" }, { eventKey: "bad" }],
    subAgentNotices: NOTICE_KINDS.map(([kind], index) => notice(kind, 4 + index)),
    timelineSequence: 2,
  });
}

function transcriptOptions(
  state: { messages: ChatTranscriptOptions["messages"] } & Pick<
    ChatTranscriptOptions,
    "subAgentDispatches" | "subAgentNotices"
  >,
  onOpenSubAgentSession: (sessionId: string) => void,
): ChatTranscriptOptions {
  return {
    app: {} as never,
    markdownContext: new Component(),
    messages: state.messages,
    subAgentDispatches: state.subAgentDispatches,
    subAgentNotices: state.subAgentNotices,
    onOpenSubAgentSession,
    editingMessageIndex: null,
    assistantLabel: "Attest",
    isDebugMode: true,
    t: ((key: string) => key) as never,
    renderEmptyState: vi.fn(),
    onEditQuestion: vi.fn(),
    onSubmitEditedQuestion: vi.fn(),
    onOpenCitationPopover: vi.fn(),
    onScheduleCitationPopoverClose: vi.fn(),
    onScrollCitationBlockIntoView: vi.fn(),
    onOpenChunk: vi.fn(),
    onOpenToolOutput: vi.fn(),
    onHighlightCitation: vi.fn(),
    onOpenDiagnosticReport: vi.fn(),
    onSaveAnswerToNewNote: vi.fn(),
    onAppendAnswerToActiveNote: vi.fn(),
  };
}

function request(question: string, history: ChatRunRequest["chatHistory"]): ChatRunRequest {
  return {
    question,
    chatHistory: history,
    appendQuestion: true,
    contextPaths: [],
    includeActiveFile: false,
    includeContextDiagnostics: false,
    modelLabel: "Model",
  };
}

describe("sub-agent events in a reloaded parent transcript", () => {
  beforeEach(() => installObsidianDomHelpers());
  afterEach(() => resetDom());

  it("shows saved dispatches and notices in order, hides legacy child payloads and keeps them through saves", async () => {
    const fileSystem = new MemoryFileSystem();
    await fileSystem.createFolder("chats");
    await fileSystem.writeText("chats/chat-legacy.json", legacyChatFile());
    const repository = new FileChatRepository({ fileSystem, folder: "chats" });
    const children = fakeChildHosts();
    const research = gatedResearch();
    const { manager } = createTestSessionManager({
      repository,
      createResearchService: research.service,
      createSubAgentSessionManager: children.factory,
    });
    const state = manager.adoptChat((await repository.loadChat("chat-legacy"))!, settings);
    const opened: string[] = [];
    const transcript = document.createElement("div");
    transcript.className = "attest-chat__transcript";

    renderChatTranscript(
      transcript,
      transcriptOptions(state, (id) => opened.push(id)),
    );

    const events = [...transcript.querySelectorAll<HTMLElement>(".attest-chat__agent-event")];
    expect(events.map((el) => el.dataset.eventKey)).toEqual([
      "dispatch:chat-legacy:p1:s1:r1",
      ...NOTICE_KINDS.map(([kind]) => `notice:chat-legacy:p1:s1:r1:${kind}`),
    ]);
    expect(events[0]!.textContent).toContain("Find primary sources for the IPO date");
    for (const [kind, title, icon, action] of NOTICE_KINDS) {
      const el = transcript.querySelector<HTMLElement>(`.attest-chat__agent-event--${kind}`)!;
      expect([
        kind,
        el.textContent?.includes(title),
        el.querySelector("[data-icon]")?.getAttribute("data-icon"),
        el.querySelector(".attest-chat__agent-open") !== null,
      ]).toEqual([kind, true, icon, action]);
    }
    transcript
      .querySelector<HTMLButtonElement>(
        ".attest-chat__agent-event--finished .attest-chat__agent-open",
      )
      ?.click();
    expect(opened).toEqual(["s1"]);
    expect(
      transcript.querySelectorAll(".attest-chat__agent-event a, .attest-chat__agent-event b"),
    ).toHaveLength(0);
    expect(transcript.textContent).toContain("javascript:alert(1)");
    expect(transcript.textContent).not.toContain("Legacy child answer");
    expect(transcript.textContent).not.toContain("Child fetch");
    expect(transcript.querySelector('[data-tool-id="own"]')).not.toBeNull();

    await manager.save(state.sessionId);
    await repository.renameChat("chat-legacy", "Renamed");
    await repository.setChatFavorite("chat-legacy", true);
    await manager.start(state.sessionId, request("Next?", state.messages));
    await settle();
    const host = children.hosts[0]!;
    host.context.mainEvents!.publish([
      {
        type: "dispatch",
        entry: {
          eventKey: "dispatch:chat-legacy:run-1:s2:r2",
          sessionId: "s2",
          runId: "r2",
          parentRunId: state.activeRunId!,
          body: "New command",
          createdAt: AT,
          commandKind: "follow-up",
          attempt: 1,
        },
      },
    ]);
    research.emit(0, {
      type: "complete",
      answer: {
        question: "Next?",
        answer: "Done",
        citations: [],
        followUpQuestions: [],
        createdAt: AT,
      },
    });
    research.end(0);
    await settle();
    await repository.setChatUnreadCompletion("chat-legacy", false);
    await repository.setChatRunState("chat-legacy", {
      ...(await repository.loadChat("chat-legacy"))!.lastRun!,
    });

    const reloaded = (await new FileChatRepository({ fileSystem, folder: "chats" }).loadChat(
      "chat-legacy",
    ))!;
    const sequences = reloaded.messages.map((message) => message.timelineSequence);
    const newest = reloaded.subAgentDispatches!.at(-1)!;
    expect(reloaded.isFavorite).toBe(true);
    expect(reloaded.subAgentDispatches!.map((entry) => entry.body)).toEqual([
      "Find primary sources for the IPO date",
      "New command",
    ]);
    expect(reloaded.subAgentNotices).toHaveLength(NOTICE_KINDS.length);
    expect(sequences.slice(0, 2)).toEqual([1, 2]);
    expect(newest.sequence).toBeGreaterThan(Math.max(...sequences.slice(0, 3).map(Number), 14));
    expect(reloaded.timelineSequence).toBeGreaterThan(Math.max(...sequences.map(Number)));
    expect(reloaded.messages[1]!.researchProgress!.chain[1]).toMatchObject({
      resultJson: '{"answer":"Legacy child answer"}',
    });
    expect(JSON.stringify(research.requests[0]!.chatHistory)).not.toContain("Legacy child answer");
    expect(children.hosts[0]!.bindings).toHaveLength(1);
  });
});
