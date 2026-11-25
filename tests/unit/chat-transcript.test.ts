// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";

import {
  patchActiveAssistantMessage,
  renderChatTranscript,
  renderFollowUps,
  type ChatTranscriptOptions,
} from "@apps/obsidian/ui/chat/ChatTranscript";
import { createTranslator } from "@adapters/i18n";
import { isIntermediateResearchMessage } from "@apps/obsidian/ui/chat/deep-research/researchMessageActions";
import { installObsidianDomHelpers, resetDom } from "../support/domHarness";
import { pendingResearch } from "../support/deepResearch";

function options(overrides: Partial<ChatTranscriptOptions> = {}): ChatTranscriptOptions {
  return {
    app: {} as never,
    markdownContext: new Component(),
    messages: [],
    editingMessageIndex: null,
    assistantLabel: "Attest",
    isDebugMode: false,
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
    ...overrides,
  };
}

describe("ChatTranscript", () => {
  beforeEach(() => installObsidianDomHelpers());
  afterEach(() => resetDom());

  it("shows the empty state when only internal compaction markers remain", () => {
    const transcript = document.createElement("div");
    const renderEmptyState = vi.fn();

    renderChatTranscript(
      transcript,
      options({
        renderEmptyState,
        messages: [
          {
            role: "assistant",
            content: "internal summary",
            createdAt: "2026-01-01T00:00:00.000Z",
            kind: "compact-summary",
          },
        ],
      }),
    );

    expect(renderEmptyState).toHaveBeenCalledWith(transcript);
    expect(transcript.querySelector(".attest-chat__message")).toBeNull();
  });

  it("renders a clarification reply as one compact line and a typed reply in full", () => {
    const transcript = document.createElement("div");
    const at = "2026-01-01T12:34:00.000Z";
    renderChatTranscript(
      transcript,
      options({
        t: createTranslator("ru").t,
        messages: [
          {
            role: "user",
            content: "Answers:\n\n1. Which database?\nAnswer: Postgres",
            createdAt: at,
            clarificationReply: { answers: { "question-1": "Postgres" }, skipped: false },
          },
          {
            role: "user",
            content: "skip",
            createdAt: at,
            clarificationReply: { answers: {}, skipped: true },
          },
          { role: "user", content: "Postgres, please", createdAt: at },
        ],
      }),
    );
    const texts = [...transcript.querySelectorAll(".attest-chat__message-text")].map(
      (el) => el.textContent,
    );
    expect(texts).toEqual([
      "Ответы на уточняющие вопросы (1)",
      "Продолжено без уточнения",
      "Postgres, please",
    ]);
  });

  it("renders attached context names and submits or cancels an edited user question", () => {
    const transcript = document.createElement("div");
    const onEditQuestion = vi.fn();
    const onSubmitEditedQuestion = vi.fn();
    const base = options({
      messages: [
        {
          role: "user",
          content: "Explain the plan",
          createdAt: "2026-01-01T12:34:00.000Z",
          contextPaths: ["Notes/Plan.md", "Books/"],
        },
      ],
      onEditQuestion,
      onSubmitEditedQuestion,
    });

    renderChatTranscript(transcript, base);
    expect(Array.from(transcript.querySelectorAll(".attest-chat__message-context-name"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ textContent: "Plan.md" }),
        expect.objectContaining({ textContent: "Books" }),
      ]),
    );
    transcript.querySelector<HTMLButtonElement>(".attest-chat__message-edit")?.click();
    expect(onEditQuestion).toHaveBeenCalledWith(0);

    renderChatTranscript(transcript, { ...base, editingMessageIndex: 0 });
    const editor = transcript.querySelector<HTMLTextAreaElement>("textarea");
    editor!.value = "Updated plan";
    editor!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    editor!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onSubmitEditedQuestion).toHaveBeenCalledWith(0, "Updated plan");
    expect(onEditQuestion).toHaveBeenLastCalledWith(-1);
  });

  it("renders no follow-ups for an empty list and sends the selected follow-up", () => {
    const container = document.createElement("div");
    const onSelect = vi.fn();

    renderFollowUps(container, [], onSelect, ((key: string) => key) as never);
    expect(container.children).toHaveLength(0);

    renderFollowUps(container, ["What changed?"], onSelect, ((key: string) => key) as never);
    container.querySelector<HTMLButtonElement>(".attest-chat__followup")?.click();

    expect(onSelect).toHaveBeenCalledWith("What changed?");
  });

  it("does not patch a transcript unless its latest visible message and DOM row are both assistant messages", () => {
    const transcript = document.createElement("div");
    expect(
      patchActiveAssistantMessage(
        transcript,
        options({
          messages: [{ role: "user", content: "Question", createdAt: "2026-01-01T00:00:00.000Z" }],
        }),
      ),
    ).toBe(false);

    const assistant = document.createElement("div");
    assistant.className = "attest-chat__message attest-chat__message--assistant";
    transcript.append(assistant);
    expect(
      patchActiveAssistantMessage(
        transcript,
        options({
          messages: [
            { role: "assistant", content: "Answer", createdAt: "2026-01-01T00:00:00.000Z" },
          ],
        }),
      ),
    ).toBe(false);
  });

  it("keeps a textarea editable when Shift+Enter is used instead of submitting the question", () => {
    const transcript = document.createElement("div");
    const onSubmitEditedQuestion = vi.fn();
    renderChatTranscript(
      transcript,
      options({
        editingMessageIndex: 0,
        onSubmitEditedQuestion,
        messages: [{ role: "user", content: "Draft", createdAt: "2026-01-01T00:00:00.000Z" }],
      }),
    );
    transcript
      .querySelector<HTMLTextAreaElement>("textarea")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));

    expect(onSubmitEditedQuestion).not.toHaveBeenCalled();
  });

  it("gives no header actions to the intermediate messages of a Deep Research run", () => {
    const transcript = document.createElement("div");
    const at = "2026-01-01T12:34:00.000Z";
    renderChatTranscript(
      transcript,
      options({
        messages: [
          { role: "user", content: "Question", createdAt: at },
          { role: "user", content: "Approve the plan", createdAt: at, researchTurn: true },
        ],
      }),
    );
    expect(
      [...transcript.querySelectorAll(".attest-chat__message")].map(
        (el) => el.querySelectorAll(".attest-chat__message-actions button").length,
      ),
    ).toEqual([2, 0]);

    const active = pendingResearch();
    const context = {
      view: {
        status: "ready" as const,
        active,
        history: [
          { researchId: "done", report: {} },
          { researchId: "failed", report: null },
        ] as never,
      },
      t: ((key: string) => key) as never,
      sentTurns: new Set<string>(),
      latestRevisions: new Map([["done", 3]]),
      onTurn: vi.fn(),
    };
    const turn = (researchId: string, revision: number) => ({
      role: "assistant" as const,
      content: "Turn",
      createdAt: at,
      research: { researchId, artifact: "plan" as const, revision },
    });
    expect(
      [
        turn(active.researchId, active.revision),
        turn("done", 1),
        turn("done", 3),
        turn("failed", 2),
        { role: "assistant" as const, content: "Answer", createdAt: at },
      ].map((message) => isIntermediateResearchMessage(message, context)),
    ).toEqual([true, true, false, true, false]);
  });

  it("ends an answer with its token usage and skips counts that are not token counts", () => {
    const transcript = document.createElement("div");
    const at = "2026-01-01T12:34:00.000Z";
    renderChatTranscript(
      transcript,
      options({
        locale: "en",
        t: ((key: string, params?: Record<string, unknown>) =>
          `${key} ${JSON.stringify(params)}`) as never,
        messages: [
          {
            role: "assistant",
            content: "A",
            createdAt: at,
            usage: { inputTokens: 12345, outputTokens: 6 },
          },
          {
            role: "assistant",
            content: "B",
            createdAt: at,
            usage: { inputTokens: -1, outputTokens: 6 },
          },
        ],
      }),
    );
    const messages = [...transcript.querySelectorAll(".attest-chat__message")];
    expect(messages.map((el) => el.lastElementChild?.textContent)).toEqual([
      'chat.message.tokens {"input":"12,345","output":"6"}',
      expect.not.stringContaining("chat.message.tokens"),
    ]);
  });

  it("exposes a debug diagnostic for an assistant response and preserves its model label", () => {
    const transcript = document.createElement("div");
    const onOpenDiagnosticReport = vi.fn();
    const diagnostics = { contextMode: "include" } as never;

    renderChatTranscript(
      transcript,
      options({
        assistantLabel: "Fallback model",
        isDebugMode: true,
        onOpenDiagnosticReport,
        messages: [
          {
            role: "assistant",
            content: "A grounded answer",
            createdAt: "2026-01-01T12:34:00.000Z",
            modelName: "Research model",
            contextDiagnostics: diagnostics,
          },
        ],
      }),
    );

    expect(transcript.querySelector(".attest-chat__message-label")?.textContent).toBe(
      "Research model",
    );
    transcript.querySelector<HTMLButtonElement>(".attest-chat__message-diagnostic")?.click();
    expect(onOpenDiagnosticReport).toHaveBeenCalledWith(diagnostics);
  });

  it("adds the sources block and answer actions to the header when a streamed answer completes", () => {
    const transcript = document.createElement("div");
    const streaming = {
      role: "assistant" as const,
      content: "Partial",
      createdAt: "2026-01-01T12:34:00.000Z",
    };
    const chunk = {
      id: "chunk-1",
      text: "Evidence text",
      score: 1,
      contentHash: "chunk-1",
      source: { id: "chunk-1", kind: "note", title: "Plan.md", path: "Notes/Plan.md" },
    } as never;
    const completed = {
      ...streaming,
      content: "Final answer",
      evidence: [chunk],
      usage: { inputTokens: 1, outputTokens: 2 },
      answer: {
        question: "Question",
        answer: "Final answer",
        citations: [{ id: "chunk-1", label: "Plan.md" }],
        followUpQuestions: [],
        createdAt: "2026-01-01T12:34:00.000Z",
      },
    } as never;

    renderChatTranscript(transcript, options({ messages: [streaming] }));
    expect(transcript.querySelector(".attest-chat__citation-blocks")).toBeNull();
    expect(transcript.querySelector(".attest-chat__message-save-answer")).toBeNull();

    expect(patchActiveAssistantMessage(transcript, options({ messages: [completed] }))).toBe(true);

    const header = transcript.querySelector(".attest-chat__message-header");
    expect(transcript.querySelector(".attest-chat__citation-blocks")).not.toBeNull();
    expect(header?.querySelector(".attest-chat__message-copy")).not.toBeNull();
    expect(header?.querySelector(".attest-chat__message-save-answer")).not.toBeNull();
    expect(header?.querySelector(".attest-chat__message-append-answer")).not.toBeNull();
    expect(transcript.querySelectorAll(".attest-chat__message-actions")).toHaveLength(1);
    expect(transcript.querySelector(".attest-chat__message")?.lastElementChild?.className).toBe(
      "attest-chat__message-usage",
    );
  });

  it("keeps readers at their position unless they are already near the transcript bottom", () => {
    const transcript = document.createElement("div");
    const message = { role: "user" as const, content: "Question", createdAt: "invalid" };
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 500 },
    });

    transcript.scrollTop = 390;
    renderChatTranscript(transcript, options({ messages: [message] }));
    expect(transcript.scrollTop).toBe(500);
    expect(transcript.querySelector(".attest-chat__message-time")?.textContent).toBe("");

    transcript.scrollTop = 120;
    renderChatTranscript(transcript, options({ messages: [message] }));
    expect(transcript.scrollTop).toBe(120);
  });
});
