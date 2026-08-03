// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ResearchQuestionController } from "@apps/obsidian/ui/chat/research/ResearchQuestionController";
import type { ResearchQuestionControllerOptions } from "@apps/obsidian/ui/chat/research/ResearchQuestionController";
import type { ResearchService, ResearchStreamEvent } from "@application/use-cases/research";
import type { ResearchRequest } from "@application/contracts/research";
import type { ResearchAnswer } from "@core/answer";
import type { ChatDisplayMessage } from "@core/conversation";
import {
  advanceTime,
  flushAnimationFrames,
  restoreDomTimers,
  useDomFakeTimers,
} from "../../helpers/domHarness";

interface RenderLogEntry {
  call: "renderMessages" | "renderActiveMessage" | "renderAnswerDetails";
  content: string;
  checkpoints: string[];
}

interface Harness {
  controller: ResearchQuestionController;
  messages: () => ChatDisplayMessage[];
  renderLog: RenderLogEntry[];
  lifecycleLog: string[];
  lastAnswer: () => ResearchAnswer | null;
  requests: ResearchRequest[];
  statuses: (string | null)[];
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

function createHarness(
  makeEvents: () => AsyncIterable<ResearchStreamEvent>,
  overrides: Partial<ResearchQuestionControllerOptions> = {},
): Harness {
  let messages: ChatDisplayMessage[] = [];
  let lastAnswer: ResearchAnswer | null = null;
  let questionInput = "Question?";
  const renderLog: RenderLogEntry[] = [];
  const lifecycleLog: string[] = [];
  const statuses: (string | null)[] = [];
  const requests: ResearchRequest[] = [];

  const snapshot = (call: RenderLogEntry["call"]): void => {
    const last = messages.at(-1);
    renderLog.push({
      call,
      content: last?.content ?? "",
      checkpoints: (last?.researchProgress?.checkpoints ?? []).map(
        (checkpoint) => `${checkpoint.id}:${checkpoint.status}`,
      ),
    });
  };

  const options: ResearchQuestionControllerOptions = {
    getQuestionInput: () => questionInput,
    clearQuestionInput: () => {
      questionInput = "";
    },
    getMessages: () => messages,
    setMessages: (next) => {
      messages = next;
    },
    getLastAnswer: () => lastAnswer,
    setLastAnswer: (answer) => {
      lastAnswer = answer;
    },
    getModelInputValue: () => "",
    getCurrentModel: () => "model-id",
    getCurrentModelLabel: () => "Model Label",
    getContextLimitTokens: () => undefined,
    getReservedOutputTokens: () => undefined,
    updateChatModel: async () => {},
    saveCurrentChat: async () => {
      lifecycleLog.push("save");
    },
    createResearchService: () =>
      ({
        answer: (request: ResearchRequest) => {
          requests.push(request);
          return makeEvents();
        },
      }) as unknown as ResearchService,
    getSearchMode: () => "indexOnly",
    getResearchMode: () => "instant",
    getContextMode: () => "include",
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
    setFormRunning: (running) => {
      lifecycleLog.push(`form:${running}`);
    },
    setRunningState: (running) => {
      lifecycleLog.push(`running:${running}`);
    },
    renderMessages: () => snapshot("renderMessages"),
    renderActiveMessage: () => snapshot("renderActiveMessage"),
    renderAnswerDetails: () => snapshot("renderAnswerDetails"),
    ...overrides,
  };

  return {
    controller: new ResearchQuestionController(options),
    messages: () => messages,
    renderLog,
    lifecycleLog,
    lastAnswer: () => lastAnswer,
    requests,
    statuses,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((res) => {
    resolve = () => res();
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  useDomFakeTimers();
});

afterEach(() => {
  restoreDomTimers();
});

describe("ResearchQuestionController streaming order", () => {
  it("promotes the checkpoint before the answer reset clears the streamed draft", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "delta", content: "Partial" };
      yield { type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "Draft" };
      yield { type: "checkpoint-complete", checkpointId: "c1", round: 1 };
      yield { type: "checkpoint-promote", checkpointId: "c1", round: 1 };
      yield { type: "answer-reset" };
      yield { type: "delta", content: "Final" };
      yield { type: "complete", answer: answerFor("Final") };
    });

    const run = harness.controller.submitQuestion();
    await flushMicrotasks();
    await advanceTime(100);
    await run;

    const streamRenders = harness.renderLog.slice(2);
    expect(streamRenders.slice(0, 2)).toEqual([
      { call: "renderActiveMessage", content: "Partial", checkpoints: ["c1:finalizing"] },
      { call: "renderMessages", content: "", checkpoints: ["c1:finalizing"] },
    ]);
    expect(harness.messages().at(-1)?.content).toBe("Final");
    expect(harness.lastAnswer()?.answer).toBe("Final");
  });

  it("drops the animation frame queued by a delta when the checkpoint is promoted", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "Draft" };
      yield { type: "delta", content: "Partial" };
      yield { type: "checkpoint-promote", checkpointId: "c1", round: 1 };
      await gate.promise;
      yield { type: "complete", answer: answerFor("Final") };
    });

    const run = harness.controller.submitQuestion();
    await flushMicrotasks();
    const rendersBeforeFrames = harness.renderLog.length;
    await advanceTime(200);

    expect(harness.renderLog.length).toBe(rendersBeforeFrames);
    expect(harness.renderLog.at(-1)).toEqual({
      call: "renderActiveMessage",
      content: "Partial",
      checkpoints: ["c1:finalizing"],
    });

    gate.resolve();
    await flushMicrotasks();
    await advanceTime(100);
    await run;
  });

  it("holds the finalizing frame before applying the completed answer", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "Draft" };
      yield { type: "checkpoint-promote", checkpointId: "c1", round: 1 };
      yield { type: "complete", answer: answerFor("Final answer") };
    });

    const run = harness.controller.submitQuestion();
    await flushMicrotasks();

    expect(harness.lastAnswer()).toBeNull();
    expect(harness.controller.isRunning()).toBe(true);

    await flushAnimationFrames();
    await flushMicrotasks();
    await run;

    expect(harness.lastAnswer()?.answer).toBe("Final answer");
    expect(harness.messages().at(-1)?.content).toBe("Final answer");
    expect(harness.messages().at(-1)?.modelName).toBe("Model Label");
  });

  it("applies a completed answer without delay when no checkpoint is finalizing", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "delta", content: "Final answer" };
      yield { type: "complete", answer: answerFor("Final answer") };
    });

    const run = harness.controller.submitQuestion();
    await flushMicrotasks();

    expect(harness.lastAnswer()?.answer).toBe("Final answer");

    await advanceTime(100);
    await run;
  });
});

describe("ResearchQuestionController cancellation", () => {
  it("aborts the request and marks the answer interrupted mid-stream", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "delta", content: "Partial" };
      await gate.promise;
      yield { type: "delta", content: " ignored" };
      yield { type: "complete", answer: answerFor("never") };
    });

    const run = harness.controller.submitQuestion();
    await flushMicrotasks();
    expect(harness.controller.isRunning()).toBe(true);

    harness.controller.stopRunningQuestion();
    gate.resolve();
    await flushMicrotasks();
    await advanceTime(100);
    await run;

    const signal = harness.requests[0]?.signal;
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as DOMException | undefined)?.name).toBe("AbortError");
    expect(harness.messages().at(-1)?.content).toBe("Partial");
    expect(harness.messages().at(-1)?.researchProgress?.phase).toBe("interrupted");
    expect(harness.lastAnswer()).toBeNull();
    expect(harness.controller.isRunning()).toBe(false);
    expect(harness.lifecycleLog.at(-1)).toBe("form:false");
    expect(harness.statuses.at(-1)).toBeNull();
  });

  it("keeps a promoted checkpoint draft as the visible answer after cancellation", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "Draft body" };
      yield { type: "checkpoint-promote", checkpointId: "c1", round: 1 };
      await gate.promise;
      yield { type: "complete", answer: answerFor("never") };
    });

    const run = harness.controller.submitQuestion();
    await flushMicrotasks();
    harness.controller.stopRunningQuestion();
    gate.resolve();
    await flushMicrotasks();
    await advanceTime(100);
    await run;

    expect(harness.messages().at(-1)?.content).toBe("Draft body");
    expect(harness.messages().at(-1)?.researchProgress?.checkpoints[0]?.status).toBe("interrupted");
  });

  it("ignores a stop request when nothing is running", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "complete", answer: answerFor("Done") };
    });

    harness.controller.stopRunningQuestion();
    const run = harness.controller.submitQuestion();
    await flushMicrotasks();
    await advanceTime(100);
    await run;

    expect(harness.messages().at(-1)?.content).toBe("Done");
    expect(harness.requests[0]?.signal?.aborted).toBe(false);
  });
});
