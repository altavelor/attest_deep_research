// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileChatRepository } from "@adapters/filesystem/FileChatRepository";
import {
  patchActiveAssistantMessage,
  renderChatTranscript,
} from "@apps/obsidian/ui/chat/ChatTranscript";
import type { SubAgentMainEventSink } from "@application/ports/subAgent";
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
const THINKING = "attest-chat__workflow-node attest-chat__workflow-node--thinking";
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
          tool("wait", "wait_subagents", undefined, "failed"),
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
      "dispatch:s1",
      "wait",
      "notice:s2:queued",
      "dispatch:s2",
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
    const line = card.querySelector<HTMLElement>(".attest-chat__agent-event-description")!;
    expect([
      line.textContent,
      line.title,
      card.textContent!.split("Agent s1").length - 1,
      card.querySelectorAll(".attest-chat__agent-open").length,
      card.querySelector(".attest-chat__agent-card-foot .attest-chat__agent-open") !== null,
      card.querySelector(".attest-chat__workflow-dot--agent")?.getAttribute("data-icon"),
      transcript.querySelector('[data-event-key="dispatch:s2"] .attest-chat__agent-event-title')
        ?.textContent,
      transcript
        .querySelector('[data-event-key="dispatch:s2"]')
        ?.textContent?.includes("chat.agent.notice.created"),
    ]).toEqual(["Agent s1", "Agent s1", 1, 1, true, "bot", "chat.agent.dispatch.title", false]);
    card.querySelector<HTMLButtonElement>(".attest-chat__agent-open")!.click();
    expect(opened).toEqual(["s1"]);
    const reply = transcript.querySelector('[data-event-key="notice:s1:finished"]')!;
    expect(reply.querySelectorAll("a, b, img, script, .markdown-rendered")).toHaveLength(0);
    expect([
      reply.textContent!.includes("javascript"),
      reply.textContent!.includes("Agent s1"),
    ]).toEqual([false, false]);
  });

  it("adds an event to a streaming answer when the active message is patched", () => {
    const transcript = document.createElement("div");
    transcript.className = "attest-chat__transcript";
    const streaming = answer("p1", [tool("search", "search_web", 2)]);
    streaming.researchProgress!.phase = "streaming";
    renderChatTranscript(
      transcript,
      transcriptOptions({ messages: [streaming] }, () => {}),
    );

    const patched = patchActiveAssistantMessage(
      transcript,
      transcriptOptions(
        { messages: [streaming], subAgentNotices: [notice("p1", "s1", "created", 3)] },
        () => {},
      ),
    );

    expect([patched, workflowKeys(transcript, "answer-p1").slice(0, 2)]).toEqual([
      true,
      ["search", "notice:s1:created"],
    ]);
  });

  it("places agent cards between the thinking steps of a live run and keeps that order after reload", async () => {
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
    const step = async (...events: Parameters<typeof research.emit>[1][]) => {
      for (const event of events) research.emit(0, event);
      await settle();
    };
    const publish = (entries: Parameters<SubAgentMainEventSink["publish"]>[0]) =>
      children.hosts[0]!.context.mainEvents!.publish(entries);
    const { sequence: _sequence, ...entry } = dispatch(runId, "s1", 0);
    const { sequence: _reply, ...reply } = notice(runId, "s1", "finished", 0);
    await step(
      { type: "reasoning", segmentId: "r1", content: "Plan" },
      { type: "tool-call-start", id: "run", name: "run_subagent", label: "R", round: 1 },
    );
    publish([{ type: "dispatch", entry }]);
    await step(
      { type: "tool-call-end", id: "run", ok: true },
      { type: "reasoning", segmentId: "r2", content: "Meanwhile" },
      { type: "tool-call-start", id: "wait", name: "wait_subagents", label: "W", round: 1 },
    );
    publish([{ type: "notice", entry: reply }]);
    await step({ type: "reasoning", segmentId: "r3", content: "Summing up" });
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

    expect(workflowKeys(transcript, `answer-${runId}`)).toEqual([
      THINKING,
      "dispatch:s1",
      THINKING,
      "notice:s1:finished",
      THINKING,
    ]);
  });
});
