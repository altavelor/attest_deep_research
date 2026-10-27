// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import { renderChatTranscript } from "@apps/obsidian/ui/chat/ChatTranscript";
import type { SavedChatSettings } from "@core/chat/savedChat";
import type { ChainItem, ChatDisplayMessage } from "@core/conversation";
import type { SubAgentDispatchEntry, SubAgentNoticeEntry } from "@core/research";
import { settle } from "../../support/async";
import {
  createTestSessionManager,
  fakeChildHosts,
  gatedResearch,
} from "../../support/chatSessions";
import { installObsidianDomHelpers, resetDom } from "../../support/domHarness";
import { MemoryFileSystem } from "../../support/memoryFileSystem";
import { transcriptOptions } from "../../support/transcriptOptions";

const AT = "2026-10-26T10:00:00.000Z";
const settings: SavedChatSettings = {
  chatModelProfileId: "model",
  searchMode: "webOnly",
  researchMode: "thinking",
};

function tool(id: string, name: string, sequence?: number, status = "complete"): ChainItem {
  return {
    kind: "tool-call",
    id,
    name,
    label: id,
    status,
    ...(sequence === undefined ? {} : { timelineSequence: sequence }),
  } as ChainItem;
}

function answer(runId: string, chain: ChainItem[]): ChatDisplayMessage {
  return {
    id: `answer-${runId}`,
    role: "assistant",
    content: "Answer",
    createdAt: AT,
    researchProgress: {
      phase: "complete",
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "complete", segments: [] },
      checkpoints: [],
      chain,
    },
  };
}

function dispatch(parentRunId: string, session: string, sequence: number): SubAgentDispatchEntry {
  return {
    eventKey: `dispatch:${session}`,
    sessionId: session,
    runId: `run-${session}`,
    parentRunId,
    body: `Command for ${session}`,
    createdAt: AT,
    commandKind: "initial",
    attempt: 1,
    sequence,
  };
}

function notice(
  parentRunId: string,
  session: string,
  kind: SubAgentNoticeEntry["kind"],
  sequence: number,
  extra: Partial<SubAgentNoticeEntry> = {},
): SubAgentNoticeEntry {
  return {
    eventKey: `notice:${session}:${kind}`,
    parentRunId,
    description: `Agent ${session}`,
    createdAt: AT,
    sessionId: session,
    runId: `run-${session}`,
    sequence,
    kind,
    ...extra,
  };
}

function workflowKeys(transcript: HTMLElement, messageId: string): string[] {
  const list = transcript.querySelector(`[data-message-id="${messageId}"] .attest-chat__workflow`)!;
  return [...list.children].map(
    (node) =>
      (node as HTMLElement).dataset.toolId ??
      (node as HTMLElement).dataset.eventKey ??
      node.className,
  );
}

describe("sub-agent events inside the parent workflow timeline", () => {
  beforeEach(() => installObsidianDomHelpers());
  afterEach(() => resetDom());

  it("renders matched events on the rail in sequence order and keeps unmatched ones standalone", () => {
    const transcript = document.createElement("div");
    transcript.className = "attest-chat__transcript";
    const opened: string[] = [];
    const state = {
      messages: [
        { id: "u1", role: "user" as const, content: "Question", createdAt: AT },
        answer("p1", [
          { kind: "reasoning", segmentId: "r", content: "Thinking" },
          tool("search", "search_web", 2),
          tool("run", "run_subagent", 5),
          tool("wait", "wait_subagents", 8, "failed"),
          tool("fetch", "fetch_web_page", 9),
          tool("result", "get_subagent_result", 12),
        ]),
        answer("p2", []),
        answer("p3", [tool("legacy", "search_web")]),
      ],
      subAgentDispatches: [
        dispatch("p1", "s1", 4),
        dispatch("p1", "s2", 7),
        dispatch("p3", "s3", 20),
      ],
      subAgentNotices: [
        notice("p1", "s1", "created", 3),
        notice("p1", "s2", "queued", 6),
        notice("p1", "s1", "finished", 10, {
          replyExcerpt: "See [x](javascript:alert(1)) <b>bold</b>",
        }),
        notice("gone", "s9", "created", 11),
        notice("p2", "s4", "created", 15),
      ],
    };

    renderChatTranscript(
      transcript,
      transcriptOptions(state, (id) => opened.push(id)),
    );

    expect(workflowKeys(transcript, "answer-p1").slice(1)).toEqual([
      "search",
      "notice:s1:created",
      "dispatch:s1",
      "notice:s2:queued",
      "dispatch:s2",
      "wait",
      "fetch",
      "notice:s1:finished",
    ]);
    expect(workflowKeys(transcript, "answer-p2")).toEqual(["notice:s4:created"]);
    expect(workflowKeys(transcript, "answer-p3")).toEqual(["legacy", "dispatch:s3"]);
    expect(
      [...transcript.querySelectorAll<HTMLElement>(".attest-chat__agent-event")].map(
        (el) => el.dataset.eventKey,
      ),
    ).toEqual(["notice:s9:created"]);
    expect(
      [...transcript.querySelectorAll<HTMLElement>(".attest-chat__agent-status")].map((el) => [
        el.dataset.status,
        el.textContent,
      ]),
    ).toEqual([
      ["finished", "chat.agent.status.finished"],
      ["queued", "chat.agent.status.queued"],
      ["running", "chat.agent.status.running"],
    ]);
    const card = transcript.querySelector('[data-event-key="dispatch:s1"]')!;
    expect(card.querySelector(".attest-chat__agent-card-title")?.textContent).toBe("Agent s1");
    expect(card.querySelector(".attest-chat__workflow-dot--agent")?.getAttribute("data-icon")).toBe(
      "send",
    );
    card.querySelector<HTMLButtonElement>(".attest-chat__agent-open")!.click();
    expect(opened).toEqual(["s1"]);
    const reply = transcript.querySelector('[data-event-key="notice:s1:finished"]')!;
    expect(reply.querySelectorAll("a, b")).toHaveLength(0);
    expect(reply.textContent).toContain("javascript:alert(1)");
  });

  it("stamps live tool calls and events from one allocator and keeps their order after reload", async () => {
    const fileSystem = new MemoryFileSystem();
    await fileSystem.createFolder("chats");
    const repository = new FileChatRepository({ fileSystem, folder: "chats" });
    const children = fakeChildHosts();
    const research = gatedResearch();
    const { manager } = createTestSessionManager({
      repository,
      createResearchService: research.service,
      createSubAgentSessionManager: children.factory,
    });
    const state = manager.createSession(settings);
    await manager.start(state.sessionId, {
      question: "Compare",
      chatHistory: [],
      appendQuestion: true,
      contextPaths: [],
      includeActiveFile: false,
      includeContextDiagnostics: false,
      modelLabel: "Model",
    });
    await settle();
    const runId = state.activeRunId!;
    research.emit(0, {
      type: "tool-call-start",
      id: "search",
      name: "search_web",
      label: "S",
      round: 1,
    });
    await settle();
    const { sequence: _sequence, ...entry } = dispatch(runId, "s1", 0);
    children.hosts[0]!.context.mainEvents!.publish([{ type: "dispatch", entry }]);
    research.emit(0, {
      type: "tool-call-start",
      id: "fetch",
      name: "fetch_web_page",
      label: "F",
      round: 1,
    });
    research.emit(0, {
      type: "complete",
      answer: {
        question: "Compare",
        answer: "Done",
        citations: [],
        followUpQuestions: [],
        createdAt: AT,
      },
    });
    research.end(0);
    await settle();

    const reloaded = (await new FileChatRepository({ fileSystem, folder: "chats" }).loadChat(
      state.chatId!,
    ))!;
    const transcript = document.createElement("div");
    transcript.className = "attest-chat__transcript";
    renderChatTranscript(
      transcript,
      transcriptOptions(reloaded, () => {}),
    );

    expect(workflowKeys(transcript, `answer-${runId}`)).toEqual(["search", "dispatch:s1", "fetch"]);
  });
});
