// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchQuestionController } from "@apps/obsidian/ui/chat/research/ResearchQuestionController";
import type { ResearchQuestionControllerOptions } from "@apps/obsidian/ui/chat/research/ResearchQuestionController";
import type { ChatRunRequest, ChatRunStartResult } from "@application/use-cases/chat";
import type { ResearchService } from "@application/use-cases/research";
import type { ChatDisplayMessage } from "@core/conversation";
import { createTranslator } from "@adapters/i18n";
import { chatHistoryForPrompt } from "@application/use-cases/chat";
import { clarificationAllowed } from "@application/use-cases/research/clarificationTool";
import { renderClarificationCard } from "@apps/obsidian/ui/chat/clarificationCard";
import { ClarificationDrafts } from "@apps/obsidian/ui/chat/clarificationDrafts";
import { takeNotices } from "../../support/obsidian";
import {
  installObsidianDomHelpers,
  resetDom,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../support/domHarness";

const t = createTranslator("en").t;

interface Harness {
  controller: ResearchQuestionController;
  messages: () => ChatDisplayMessage[];
  requests: ChatRunRequest[];
  statuses: (string | null)[];
  stops: number;
  questionInput: () => string;
}

function createHarness(overrides: Partial<ResearchQuestionControllerOptions> = {}): Harness {
  let messages: ChatDisplayMessage[] = [];
  let questionInput = "Question?";
  let running = false;
  const requests: ChatRunRequest[] = [];
  const statuses: (string | null)[] = [];
  const harness = { stops: 0 } as Harness;

  const options: ResearchQuestionControllerOptions = {
    getSessionId: () => "session-1",
    isSessionDisplayed: () => true,
    getQuestionInput: () => questionInput,
    clearQuestionInput: () => {
      questionInput = "";
    },
    getMessages: () => messages,
    setMessages: (_sessionId, next) => {
      messages = next;
    },
    getModelInputValue: () => "",
    getCurrentModel: () => "model-id",
    getCurrentModelLabel: () => "Model Label",
    getContextLimitTokens: () => undefined,
    getReservedOutputTokens: () => undefined,
    isRunning: () => running,
    updateChatModel: async () => {},
    saveCurrentChat: async () => {},
    createResearchService: () => ({}) as unknown as ResearchService,
    startRun: async (_sessionId, request): Promise<ChatRunStartResult> => {
      requests.push(request);
      running = true;
      return { started: true };
    },
    stopRun: () => {
      harness.stops += 1;
    },
    getActiveFilePath: () => undefined,
    shouldIncludeActiveFileContext: () => false,
    shouldIncludeContextDiagnostics: () => false,
    getContextPaths: () => [],
    clearContextPaths: () => {},
    getSearchUnavailableMessage: () => null,
    setEditingMessageIndex: () => {},
    setProgressStatus: (message) => {
      statuses.push(message);
    },
    renderMessages: () => {},
    t,
    ...overrides,
  };

  Object.assign(harness, {
    controller: new ResearchQuestionController(options),
    messages: () => messages,
    requests,
    statuses,
    questionInput: () => questionInput,
  });
  return harness;
}

beforeEach(() => {
  useDomFakeTimers();
  takeNotices();
});

afterEach(() => {
  restoreDomTimers();
  resetDom();
});

describe("ResearchQuestionController submission", () => {
  it("hands the question and its capture-time context to the session manager", async () => {
    const harness = createHarness({
      getContextPaths: () => ["notes/a.md"],
      getActiveFilePath: () => "notes/open.md",
      shouldIncludeActiveFileContext: () => true,
    });

    await harness.controller.submitQuestion();

    expect(harness.requests).toEqual([
      {
        question: "Question?",
        chatHistory: [],
        appendQuestion: true,
        contextPaths: ["notes/a.md"],
        activeFilePath: "notes/open.md",
        includeActiveFile: true,
        includeContextDiagnostics: false,
        modelLabel: "Model Label",
      },
    ]);
    expect(harness.questionInput()).toBe("");
  });

  it("keeps the active file snapshot when model selection is asynchronous", async () => {
    let activeFilePath = "notes/old.md";
    let includeActiveFile = true;
    const harness = createHarness({
      getActiveFilePath: () => activeFilePath,
      shouldIncludeActiveFileContext: () => includeActiveFile,
      updateChatModel: async () => {
        activeFilePath = "notes/new.md";
        includeActiveFile = false;
      },
    });

    await harness.controller.submitQuestion();

    expect(harness.requests[0]).toMatchObject({
      activeFilePath: "notes/old.md",
      includeActiveFile: true,
    });
  });

  it("does not submit twice while a run is active", async () => {
    const harness = createHarness();

    await harness.controller.submitQuestion();
    await harness.controller.submitQuestion();

    expect(harness.requests).toHaveLength(1);
  });

  it("keeps the question and reports the failure when the run cannot start", async () => {
    const harness = createHarness({
      startRun: async () => ({ started: false, error: new Error("disk full") }),
    });

    await harness.controller.submitQuestion();

    expect(harness.questionInput()).toBe("Question?");
    expect(harness.statuses.at(-1)).toBe("The chat could not be saved, so the run did not start.");
    expect(takeNotices().map((notice) => notice.message)).toContain(
      "The chat could not be saved, so the run did not start.",
    );
  });

  it("refuses to start when search is unavailable", async () => {
    const harness = createHarness({
      getSearchUnavailableMessage: () => "Index this profile first.",
    });

    await harness.controller.submitQuestion();

    expect(harness.requests).toEqual([]);
  });

  it("rejects a question that cannot fit the context window", async () => {
    const harness = createHarness({
      getContextLimitTokens: () => 1,
      getQuestionInput: () => "A very long question that will never fit into a single token.",
    });

    await harness.controller.submitQuestion();

    expect(harness.requests).toEqual([]);
    expect(harness.statuses.at(-1)).toBe(
      "The current chat is too long for the selected model context window.",
    );
  });

  it("checks a clarification reply against the context window and keeps its Thinking turn", async () => {
    const reply = { answers: { "question-1": "Postgres" }, skipped: false };
    let limit = 1;
    const harness = createHarness({ getContextLimitTokens: () => limit });

    await expect(harness.controller.submitClarificationReply("Answers", reply)).resolves.toEqual({
      started: false,
      reason: "The current chat is too long for the selected model context window.",
    });
    expect(harness.requests).toEqual([]);
    expect(takeNotices()).toEqual([]);

    limit = 100_000;
    await expect(harness.controller.submitClarificationReply("Answers", reply)).resolves.toEqual({
      started: true,
    });
    expect(harness.requests[0]).toMatchObject({
      question: "Answers",
      thinking: true,
      clarificationReply: reply,
    });
  });

  it("forwards a stop request to the session manager", () => {
    const harness = createHarness();

    harness.controller.stopRunningQuestion();

    expect(harness.stops).toBe(1);
  });

  it("rewrites an edited question in place and reruns it without appending", async () => {
    const messages: ChatDisplayMessage[] = [
      { role: "user", content: "Old question", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const harness = createHarness({
      getMessages: () => messages,
      setMessages: (_sessionId, next) => {
        messages.splice(0, messages.length, ...next);
      },
    });

    await harness.controller.submitEditedQuestion(0, "New question");

    expect(messages[0]?.content).toBe("New question");
    expect(harness.requests[0]).toMatchObject({
      question: "New question",
      appendQuestion: false,
    });
  });
});

describe("ResearchQuestionController compaction", () => {
  it("keeps a card reply linked to its card when automatic compaction fires", async () => {
    installObsidianDomHelpers();
    const at = "2026-01-01T00:00:00.000Z";
    const card: ChatDisplayMessage = {
      role: "assistant",
      content: "",
      createdAt: at,
      answer: {
        question: "Q",
        answer: "",
        citations: [],
        followUpQuestions: [],
        createdAt: at,
        clarification: {
          questions: [{ questionId: "question-1", prompt: "Which database?", suggestions: [] }],
        },
      },
    };
    let messages: ChatDisplayMessage[] = [
      ...Array.from({ length: 7 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: "Long history entry. ".repeat(60),
        createdAt: at,
      })),
      card,
    ];
    const reply = { answers: { "question-1": "Postgres" }, skipped: false };
    const harness = createHarness({
      getMessages: () => messages,
      setMessages: (_sessionId, next) => {
        messages = next;
      },
      getContextLimitTokens: () => 2000,
      createResearchService: () =>
        ({
          summarizeChatHistoryForCompaction: async () => ({
            userGoals: [],
            decisions: [],
            unresolvedQuestions: [],
            citedSourcesAlreadyUsed: [],
          }),
        }) as unknown as ResearchService,
    });

    await harness.controller.submitClarificationReply("Answers", reply);

    expect(messages.some((message) => message.content === t("chat.compact.automaticMessage"))).toBe(
      true,
    );
    expect(clarificationAllowed(chatHistoryForPrompt(harness.requests[0]!.chatHistory))).toBe(
      false,
    );
    const stored = messages.find((message) => message.answer?.clarification)!;
    const host = document.createElement("div");
    renderClarificationCard(
      host,
      stored,
      [...messages, { role: "user", content: "Answers", createdAt: at, clarificationReply: reply }],
      {
        t,
        running: false,
        onReply: async () => ({ started: true }),
        drafts: new ClarificationDrafts(),
        requestRedisplay: () => {},
      },
    );
    expect(host.textContent).toContain("Postgres");
  });

  it("reports that there is nothing to compact", async () => {
    const harness = createHarness({ getQuestionInput: () => "/compact" });

    await harness.controller.submitQuestion();

    expect(harness.requests).toEqual([]);
    expect(harness.statuses.at(-1)).toBe("There is not enough older chat history to compact.");
  });
});

describe("ResearchQuestionController running state", () => {
  it("mirrors the manager's running state", () => {
    const running = vi.fn(() => true);
    const harness = createHarness({ isRunning: running });

    expect(harness.controller.isRunning()).toBe(true);
    expect(running).toHaveBeenCalled();
  });
  it("finishes a compacted submission in the chat it was captured from", async () => {
    let sessionId = "session-a";
    let questionInput = "First question";
    const messages: Record<string, ChatDisplayMessage[]> = {
      "session-a": Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: "Long history entry. ".repeat(60),
        createdAt: `2026-01-01T00:00:0${index}.000Z`,
      })),
      "session-b": [],
    };
    let releaseSummary = (): void => {};
    const summarized = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    const startedIn: string[] = [];

    const harness = createHarness({
      getSessionId: () => sessionId,
      getQuestionInput: () => questionInput,
      getMessages: (id) => messages[id] ?? [],
      setMessages: (id, next) => {
        messages[id] = next;
      },
      getContextLimitTokens: () => 2000,
      createResearchService: () =>
        ({
          summarizeChatHistoryForCompaction: async () => {
            await summarized;
            return {
              userGoals: ["Keep the decision"],
              decisions: [],
              unresolvedQuestions: [],
              citedSourcesAlreadyUsed: [],
            };
          },
        }) as unknown as ResearchService,
      startRun: async (id, request): Promise<ChatRunStartResult> => {
        startedIn.push(id);
        harness.requests.push(request);
        return { started: true };
      },
    });

    const submission = harness.controller.submitQuestion();
    await Promise.resolve();
    sessionId = "session-b";
    questionInput = "Unsent draft of the other chat";
    releaseSummary();
    await submission;

    expect(startedIn).toEqual(["session-a"]);
    expect(harness.requests.map((request) => request.question)).toEqual(["First question"]);
    expect(messages["session-b"]).toEqual([]);
  });
});
