import {
  completeAssistantCheckpoint,
  finalizeLastAssistantReasoning,
  interruptLastAssistantProgress,
  nextChainReasoningSegment,
  nextChainSubAgentPhase,
  nextChainToolCallEnd,
  nextChainToolCallStart,
  nextAssistantCheckpoint,
  nextAssistantReasoning,
  startAssistantProgress,
} from "@core/conversation";

describe("research progress reducers edge cases", () => {
  it("appends to an existing reasoning segment instead of creating a duplicate", () => {
    const first = nextAssistantReasoning(startAssistantProgress([], "thinking"), "plan", "Find ");
    const updated = nextAssistantReasoning(first, "plan", "sources");

    expect(updated.at(-1)?.researchProgress?.reasoning.segments).toEqual([
      { id: "plan", kind: "summary", content: "Find sources" },
    ]);
  });

  it("leaves a transcript unchanged when no assistant checkpoint can be completed", () => {
    const messages = startAssistantProgress([], "thinking");

    expect(completeAssistantCheckpoint([], "missing")).toEqual([]);
    expect(completeAssistantCheckpoint(messages, "missing")).toEqual(messages);
  });

  it("marks streamed checkpoints interrupted when reasoning completes", () => {
    const messages = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round",
      1,
      "Draft",
    );
    const completed = finalizeLastAssistantReasoning(messages);

    expect(completed.at(-1)?.researchProgress).toMatchObject({
      phase: "complete",
      reasoning: { phase: "complete" },
      checkpoints: [{ id: "round", status: "interrupted" }],
    });
  });

  it("keeps later checkpoint offsets valid when an earlier round moves into the workflow", () => {
    const first = nextAssistantCheckpoint(
      startAssistantProgress([], "thinking"),
      "round-1",
      1,
      "Plan. ",
    );
    const second = nextAssistantCheckpoint(first, "round-2", 2, "Answer.");

    const demoted = completeAssistantCheckpoint(second, "round-1");
    const final = completeAssistantCheckpoint(demoted, "round-2");

    expect(demoted.at(-1)?.content).toBe("Answer.");
    expect(final.at(-1)).toMatchObject({
      content: "",
      researchProgress: {
        chain: [
          { id: "round-1", status: "complete", content: "Plan. " },
          { id: "round-2", status: "complete", content: "Answer." },
        ],
      },
    });
  });

  it("records nested tool results and sub-agent phase without changing sibling calls", () => {
    const root = nextChainToolCallStart(
      startAssistantProgress([], "thinking"),
      "agent-1",
      "run_subagent",
      "Research",
    );
    const withChild = nextChainToolCallStart(
      root,
      "search-1",
      "search_web",
      "Search",
      { query: "Ixplorer" },
      "agent-1",
      undefined,
      ["DuckDuckGo"],
    );
    const completed = nextChainToolCallEnd(
      nextChainSubAgentPhase(withChild, "agent-1", "synthesizing"),
      "search-1",
      true,
      "Found sources",
      "Two results",
      '{"count":2}',
      "agent-1",
    );

    expect(completed.at(-1)?.researchProgress?.chain).toEqual([
      {
        kind: "tool-call",
        id: "agent-1",
        name: "run_subagent",
        label: "Research",
        status: "pending",
        phase: "synthesizing",
        children: [
          {
            kind: "tool-call",
            id: "search-1",
            name: "search_web",
            label: "Found sources",
            status: "complete",
            args: { query: "Ixplorer" },
            searchSources: ["DuckDuckGo"],
            resultSummary: "Two results",
            resultJson: '{"count":2}',
          },
        ],
      },
    ]);
  });

  it("creates progress after a user message and retains standalone reasoning workflow nodes", () => {
    const afterUser = [{ role: "user" as const, content: "Find sources", createdAt: "now" }];
    const first = nextChainReasoningSegment(afterUser, "plan", "Inspect ");
    const updated = nextChainReasoningSegment(first, "plan", "the index");

    expect(updated).toHaveLength(2);
    expect(updated.at(-1)?.researchProgress?.chain).toEqual([
      { kind: "reasoning", segmentId: "plan", content: "Inspect the index" },
    ]);
  });

  it("does not create orphaned nested calls and records a failed top-level result", () => {
    const started = startAssistantProgress([], "thinking");
    const orphan = nextChainToolCallStart(
      started,
      "child",
      "search_web",
      "Search",
      undefined,
      "missing-parent",
    );
    const root = nextChainToolCallStart(orphan, "fetch", "fetch_web_page", "Fetch");
    const completed = nextChainToolCallEnd(root, "fetch", false, undefined, "Timed out");

    expect(orphan.at(-1)?.researchProgress?.chain).toEqual([]);
    expect(completed.at(-1)?.researchProgress?.chain).toEqual([
      {
        kind: "tool-call",
        id: "fetch",
        name: "fetch_web_page",
        label: "Fetch",
        status: "failed",
        resultSummary: "Timed out",
      },
    ]);
  });

  it("leaves non-progress messages unchanged when finalizing or interrupting", () => {
    const messages = [{ role: "assistant" as const, content: "Plain answer", createdAt: "now" }];

    expect(finalizeLastAssistantReasoning(messages)).toEqual(messages);
    expect(interruptLastAssistantProgress(messages)).toEqual(messages);
    expect(nextChainToolCallEnd(messages, "missing", false)).toEqual(messages);
    expect(nextChainSubAgentPhase(messages, "missing", "done")).toEqual(messages);
  });
});
