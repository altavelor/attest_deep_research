import { describe, expect, it, vi } from "vitest";

import type { ChatSessionChange, ChatSessionState } from "@application/use-cases/chat";
import type { ChatSessionManager } from "@application/use-cases/chat";
import type { ResearchService, ResearchStreamEvent } from "@application/use-cases/research";
import type { ResearchRequest } from "@application/contracts/research";
import type { ResearchAnswer } from "@core/answer";
import { AttestError } from "@core/errors";
import type { SavedChatSettings } from "@core/chat/savedChat";
import { createTestSessionManager } from "../helpers/chatSessions";

const settings: SavedChatSettings = {
  chatModelProfileId: "model-id",
  indexProfileId: "index-id",
  searchMode: "indexOnly",
  contextMode: "include",
  researchMode: "instant",
};

function answerFor(text: string): ResearchAnswer {
  return {
    question: "Question?",
    answer: text,
    citations: [],
    followUpQuestions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((res) => {
    resolve = () => res();
  });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

interface Harness {
  manager: ChatSessionManager;
  state: ChatSessionState;
  requests: ResearchRequest[];
  changes: ChatSessionChange[];
  logged: unknown[];
  start(question?: string): Promise<void>;
}

function createHarness(
  makeEvents: () => AsyncIterable<ResearchStreamEvent>,
  overrides: {
    chatSettings?: Partial<SavedChatSettings>;
    createResearchService?: () => ResearchService;
  } = {},
): Harness {
  const requests: ResearchRequest[] = [];
  const changes: ChatSessionChange[] = [];
  const logged: unknown[] = [];
  const { manager } = createTestSessionManager({
    createResearchService:
      overrides.createResearchService ??
      (() =>
        ({
          answer: (request: ResearchRequest) => {
            requests.push(request);
            return makeEvents();
          },
        }) as unknown as ResearchService),
    logError: (error) => logged.push(error),
  });
  const state = manager.createSession({ ...settings, ...overrides.chatSettings });
  manager.select(state.sessionId);
  manager.subscribe((change) => changes.push(change));

  return {
    manager,
    state,
    requests,
    changes,
    logged,
    start: async (question = "Question?") => {
      await manager.start(state.sessionId, {
        question,
        chatHistory: [],
        appendQuestion: true,
        contextPaths: [],
        includeActiveFile: false,
        includeContextDiagnostics: false,
        modelLabel: "Model Label",
      });
    },
  };
}

describe("chat session runtime streaming", () => {
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

    await harness.start();
    await settle();

    expect(harness.state.messages.at(-1)?.researchProgress?.chain).toContainEqual({
      kind: "checkpoint",
      id: "c1",
      round: 1,
      content: "Draft",
      status: "complete",
    });
    expect(harness.state.messages.at(-1)?.content).toBe("Final");
    expect(harness.state.lastAnswer?.answer).toBe("Final");
    expect(harness.state.status).toBe("completed");
  });

  it("shows a streaming round as the provisional body and demotes it when it is not final", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "Looking around" };
      await gate.promise;
      yield { type: "checkpoint-complete", checkpointId: "c1", round: 1 };
      yield { type: "checkpoint-delta", checkpointId: "c2", round: 2, content: "The answer" };
      yield { type: "checkpoint-promote", checkpointId: "c2", round: 2 };
      yield { type: "complete", answer: answerFor("The answer, cited") };
    });

    await harness.start();
    await settle();
    expect(harness.state.messages.at(-1)?.content).toBe("Looking around");

    gate.resolve();
    await settle();

    expect(harness.state.messages.at(-1)?.content).toBe("The answer, cited");
    expect(harness.state.messages.at(-1)?.researchProgress?.chain).toEqual([
      { kind: "checkpoint", id: "c1", round: 1, content: "Looking around", status: "complete" },
    ]);
  });

  it("stamps the model label and marks the answer complete", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "delta", content: "Final answer" };
      yield { type: "complete", answer: answerFor("Final answer") };
    });

    await harness.start();
    await settle();

    expect(harness.state.messages.at(-1)?.content).toBe("Final answer");
    expect(harness.state.messages.at(-1)?.modelName).toBe("Model Label");
    expect(harness.changes.map((change) => change.kind)).toContain("answer");
  });

  it("reports streaming progress through progress changes only", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "status", message: "Searching" };
      yield { type: "complete", answer: answerFor("Done") };
    });

    await harness.start();
    await settle();

    expect(harness.changes.filter((change) => change.kind === "progress")).toHaveLength(1);
    expect(harness.state.progressLabel).toBeNull();
  });
});

describe("chat session runtime research mode", () => {
  it("records the selected mode on the progress it creates", async () => {
    const harness = createHarness(
      async function* events() {
        yield { type: "complete", answer: answerFor("Done") };
      },
      { chatSettings: { researchMode: "thinking" } },
    );

    await harness.start();
    await settle();

    expect(harness.requests[0]?.mode).toBe("thinking");
    expect(harness.state.messages.at(-1)?.researchProgress?.mode).toBe("thinking");
  });

  it("marks an Instant run so the transcript can skip the workflow block", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      await gate.promise;
      yield { type: "complete", answer: answerFor("Done") };
    });

    await harness.start();
    await settle();

    expect(harness.state.messages.at(-1)?.researchProgress).toMatchObject({
      phase: "streaming",
      mode: "instant",
    });

    gate.resolve();
    await settle();
    expect(harness.state.messages.at(-1)?.researchProgress?.mode).toBe("instant");
  });

  it("uses Thinking mode for an explicit sub-agent directive", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "complete", answer: answerFor("Done") };
    });

    await harness.start("@run_subagent Compare the notes");
    await settle();

    expect(harness.requests[0]).toMatchObject({
      mode: "thinking",
      forceSubAgent: true,
      question: "Compare the notes",
    });
    expect(harness.state.messages.at(-1)?.researchProgress?.mode).toBe("thinking");
  });
});

describe("chat session runtime cancellation", () => {
  it("aborts the request and marks the answer interrupted mid-stream", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "delta", content: "Partial" };
      await gate.promise;
      yield { type: "delta", content: " ignored" };
      yield { type: "complete", answer: answerFor("never") };
    });

    await harness.start();
    await settle();
    expect(harness.state.status).toBe("running");

    harness.manager.stop(harness.state.sessionId);
    expect(harness.state.status).toBe("stopping");
    gate.resolve();
    await settle();

    const signal = harness.requests[0]?.signal;
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as DOMException | undefined)?.name).toBe("AbortError");
    expect(harness.state.messages.at(-1)?.content).toBe("Partial");
    expect(harness.state.messages.at(-1)?.researchProgress?.phase).toBe("interrupted");
    expect(harness.state.lastAnswer).toBeNull();
    expect(harness.state.status).toBe("interrupted");
    expect(harness.state.interruptionReason).toBe("user");
  });

  it("keeps a promoted checkpoint draft as the visible answer after cancellation", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "checkpoint-delta", checkpointId: "c1", round: 1, content: "Draft body" };
      yield { type: "checkpoint-promote", checkpointId: "c1", round: 1 };
      await gate.promise;
      yield { type: "complete", answer: answerFor("never") };
    });

    await harness.start();
    await settle();
    harness.manager.stop(harness.state.sessionId);
    gate.resolve();
    await settle();

    expect(harness.state.messages.at(-1)?.content).toBe("Draft body");
    expect(harness.state.messages.at(-1)?.researchProgress?.checkpoints[0]?.status).toBe(
      "interrupted",
    );
  });

  it("does not register answer sources for a run that was stopped before completing", async () => {
    const gate = deferred();
    let harness: Harness;
    const finalized: ResearchAnswer[] = [];
    harness = createHarness(async function* events() {
      yield { type: "delta", content: "Partial" };
      await gate.promise;
      const bound = harness.requests[0]?.finalizeAnswer?.(answerFor("Done [source-1:revision-1]"));
      if (bound) finalized.push(bound);
      yield { type: "complete", answer: answerFor("Done") };
    });

    await harness.start();
    await settle();
    harness.manager.stop(harness.state.sessionId);
    gate.resolve();
    await settle();

    expect(harness.state.sourceRegistry.sources).toEqual([]);
    expect(finalized[0]?.answer).toBe("Done [source-1:revision-1]");
  });

  it("ignores repeated stop requests and a stop with nothing running", async () => {
    const harness = createHarness(async function* events() {
      yield { type: "complete", answer: answerFor("Done") };
    });

    harness.manager.stop(harness.state.sessionId);
    expect(harness.state.status).toBe("idle");

    await harness.start();
    await settle();
    harness.manager.stop(harness.state.sessionId);
    harness.manager.stop(harness.state.sessionId);

    expect(harness.state.status).toBe("completed");
    expect(harness.requests[0]?.signal?.aborted).toBe(false);
  });

  it("drops events that arrive after the run was fenced", async () => {
    const gate = deferred();
    const harness = createHarness(async function* events() {
      yield { type: "delta", content: "Partial" };
      await gate.promise;
      yield { type: "delta", content: " late" };
    });

    await harness.start();
    await settle();
    harness.manager.stop(harness.state.sessionId);
    await settle();
    const contentAfterStop = harness.state.messages.at(-1)?.content;

    gate.resolve();
    await settle();

    expect(contentAfterStop).toBe("Partial");
    expect(harness.state.messages.at(-1)?.content).toBe("Partial");
    expect(harness.state.messages.at(-1)?.researchProgress?.phase).toBe("interrupted");
  });
});

describe("chat session runtime failures", () => {
  it("shows the settings error and logs it when the research service cannot be built", async () => {
    const failure = new AttestError({
      code: "INVALID_SETTINGS",
      message: "Index this profile before using it in chat or search.",
    });
    const harness = createHarness(
      async function* events() {
        yield { type: "complete", answer: answerFor("never") };
      },
      {
        createResearchService: () => {
          throw failure;
        },
      },
    );

    await harness.start();
    await settle();

    expect(harness.state.status).toBe("failed");
    expect(harness.state.messages.at(-1)?.content).toBe(
      "Index this profile before using it in chat or search.",
    );
    expect(harness.logged).toEqual([failure]);
  });

  it("keeps the session idle and retryable when the run-start save fails", async () => {
    const failure = new Error("disk full");
    const { manager, repository } = createTestSessionManager({
      createResearchService: () => {
        throw new Error("The model must not be contacted.");
      },
    });
    vi.spyOn(repository, "saveChat").mockRejectedValue(failure);
    const state = manager.createSession(settings);
    manager.select(state.sessionId);

    const result = await manager.start(state.sessionId, {
      question: "Question?",
      chatHistory: [],
      appendQuestion: true,
      contextPaths: [],
      includeActiveFile: false,
      includeContextDiagnostics: false,
      modelLabel: "Model Label",
    });

    expect(result.started).toBe(false);
    expect(result.error).toBe(failure);
    expect(state.status).toBe("idle");
    expect(state.chatId).toBeNull();
    expect(state.messages).toEqual([]);
  });
});
