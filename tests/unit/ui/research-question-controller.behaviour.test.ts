// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchQuestionController } from "@apps/obsidian/ui/chat/research/ResearchQuestionController";
import type { ResearchQuestionControllerOptions } from "@apps/obsidian/ui/chat/research/ResearchQuestionController";
import type { ChatRunRequest, ChatRunStartResult } from "@application/use-cases/chat";
import type { ResearchService } from "@application/use-cases/research";
import type { ChatDisplayMessage } from "@core/conversation";
import { createTranslator } from "@adapters/i18n";
import { takeNotices } from "../../stubs/obsidian";
import { resetDom, restoreDomTimers, useDomFakeTimers } from "../../helpers/domHarness";

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
    getQuestionInput: () => questionInput,
    clearQuestionInput: () => {
      questionInput = "";
    },
    getMessages: () => messages,
    setMessages: (next) => {
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
    startRun: async (request): Promise<ChatRunStartResult> => {
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
      setMessages: (next) => {
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
});
