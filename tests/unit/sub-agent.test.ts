import { parseSubAgentDirective } from "@core/research";
import { SubAgentRunner } from "@application/use-cases/research/sub-agent/SubAgentRunner";
import { SubAgentTool } from "@adapters/research-tools/sub-agent/SubAgentTool";
import { SubAgentPort, SubAgentTelemetry } from "@application/research";
import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { FakeChatModel, FakeSearchProvider } from "../helpers/researchFakes";
import { markdownSource, retrieved, webSource } from "../helpers/factories";
import type {
  ModelRoundProvider,
  ModelRoundRequest,
  ModelRoundResult,
  ToolContext,
} from "@core/agent";
import { SUB_AGENT_PHASE, SUB_AGENT_TOOL_END, SUB_AGENT_TOOL_START } from "@application/research";
import { SYNTHESIS_TOOL_STUB } from "@application/use-cases/research/ThinkingToolRoundExecutor";

function toolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: "call-1",
    signal: new AbortController().signal,
    emit: () => {},
    ...overrides,
  };
}

describe("parseSubAgentDirective", () => {
  it("detects and strips a standalone @run_subagent mention", () => {
    const result = parseSubAgentDirective("@run_subagent what changed in v2?");
    expect(result.forceSubAgent).toBe(true);
    expect(result.cleanedQuestion).toBe("what changed in v2?");
  });

  it("strips a mid-sentence mention and collapses whitespace", () => {
    const result = parseSubAgentDirective("compare @run_subagent the two libraries");
    expect(result.forceSubAgent).toBe(true);
    expect(result.cleanedQuestion).toBe("compare the two libraries");
  });

  it("leaves a question without the mention untouched", () => {
    const result = parseSubAgentDirective("run the subagent on my notes");
    expect(result.forceSubAgent).toBe(false);
    expect(result.cleanedQuestion).toBe("run the subagent on my notes");
  });
});

describe("SubAgentTool", () => {
  function stubRunner(
    answerText: string,
    snapshot: ReturnType<typeof buildSnapshot>,
  ): SubAgentPort {
    return {
      run: async (input) => {
        input.onEvent?.({ type: "sub-agent-phase", message: "Searching…" });
        return { answerText, snapshot };
      },
    };
  }

  function buildSnapshot(
    entries: {
      chunk: ReturnType<typeof retrieved>;
      tool: "search_web" | "search_index" | "read_note";
    }[],
  ) {
    return {
      evidence: entries.map((entry) => entry.chunk),
      citations: [],
      provenance: entries.map((entry) => ({
        evidenceId: entry.chunk.id,
        calls: [
          entry.tool === "search_web" || entry.tool === "search_index"
            ? { callId: "sub-call-1", query: "q", tool: entry.tool }
            : { callId: "sub-call-1", tool: entry.tool },
        ],
      })),
    };
  }

  it("merges web evidence into the parent registry and returns the answer verbatim", async () => {
    const snapshot = buildSnapshot([
      {
        chunk: retrieved("web:sub-1", webSource("https://e.com/x"), "X benchmark text"),
        tool: "search_web",
      },
    ]);
    const evidence = new ResearchEvidenceRegistry();
    const tool = new SubAgentTool({
      runner: stubRunner("Fast [url:https://e.com/x].", snapshot),
      evidence,
    });

    const result = await tool.execute({ task: "How fast is X?", maxSearches: 8 }, toolContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sourceCount).toBe(1);
    expect(result.value.answer).toBe("Fast [url:https://e.com/x].");
    expect(evidence.snapshot().evidence).toHaveLength(1);
  });

  it("merges note evidence via registerNoteEvidence, keyed by provenance tool", async () => {
    const noteChunk = retrieved("note-1", markdownSource("Notes/X.md"), "Note content");
    const snapshot = buildSnapshot([{ chunk: noteChunk, tool: "read_note" }]);
    const evidence = new ResearchEvidenceRegistry();
    const tool = new SubAgentTool({ runner: stubRunner("Per [note-1].", snapshot), evidence });

    const result = await tool.execute({ task: "Summarize X", maxSearches: 8 }, toolContext());

    expect(result.ok).toBe(true);
    expect(evidence.snapshot().evidence).toHaveLength(1);
    expect(evidence.snapshot().evidence[0].id).toBe("note-1");
  });

  it("forwards sub-agent progress through the tool's emit channel", async () => {
    const snapshot = buildSnapshot([]);
    const events: unknown[] = [];
    const tool = new SubAgentTool({
      runner: stubRunner("Answer.", snapshot),
      evidence: new ResearchEvidenceRegistry(),
    });

    await tool.execute(
      { task: "q", maxSearches: 8 },
      toolContext({ emit: (event) => events.push(event) }),
    );

    expect(events).toContainEqual({ type: "sub-agent-phase", message: "Searching…" });
  });

  it("rejects an empty task", () => {
    const tool = new SubAgentTool({
      runner: stubRunner("", buildSnapshot([])),
      evidence: new ResearchEvidenceRegistry(),
    });
    const parsed = tool.parseInput({ task: "  " });
    expect(parsed.ok).toBe(false);
  });
});

describe("SubAgentRunner", () => {
  it("uses the toolContext handed to it instead of a hardcoded web-only toolset", async () => {
    const chatModel = new FakeChatModel([[{ content: "Answer.", isComplete: true }]]);

    const toolsetOptionsSeen: unknown[] = [];
    const spyFactory: typeof createResearchToolRegistry = (options) => {
      toolsetOptionsSeen.push(options);
      return createResearchToolRegistry(options);
    };

    const runner = new SubAgentRunner({
      toolsetFactory: spyFactory,
      searchProvider: new FakeSearchProvider([]),
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    const toolContext = {
      availability: {
        searchMode: "indexOnly" as const,
        noteAccess: true,
        activeFileAccess: false,
        retrieverAvailable: false,
        webProviderAvailable: false,
        noteMutationAccess: true,
      },
    };

    const result = await runner.run({ task: "Summarize my notes on X", toolContext });

    expect(result.answerText).toBe("Answer.");

    expect(toolsetOptionsSeen[0]).toMatchObject({ availability: toolContext.availability });
  });

  it("falls back to a web-only toolset when no toolContext is supplied", async () => {
    const chatModel = new FakeChatModel([[{ content: "Answer.", isComplete: true }]]);
    const availabilitiesSeen: unknown[] = [];
    const spyFactory: typeof createResearchToolRegistry = (options) => {
      availabilitiesSeen.push(options.availability);
      return createResearchToolRegistry(options);
    };

    const runner = new SubAgentRunner({
      toolsetFactory: spyFactory,
      searchProvider: new FakeSearchProvider([]),
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    await runner.run({ task: "What is X?" });

    expect(availabilitiesSeen[0]).toMatchObject({
      searchMode: "webOnly",
      retrieverAvailable: false,
      noteAccess: false,
      webProviderAvailable: true,
    });
  });

  it("runs a tool-less synthesis pass when the loop ends without an answer", async () => {
    const chatModel = new FakeChatModel([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "1", name: "search_web", arguments: { query: "a", limit: 3 } }],
        },
      ],
      [{ content: "", isComplete: true }],
      [{ content: "Synthesized from gathered evidence.", isComplete: true }],
    ]);
    const searchProvider = new FakeSearchProvider([
      {
        source: webSource("https://e.com/x"),
        extractedText: "benchmark text",
        rank: 1,
        query: "a",
      },
    ]);

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider,
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    const result = await runner.run({ task: "What is X?" });

    expect(result.answerText).toBe("Synthesized from gathered evidence.");
    const sawSynthesisPrompt = chatModel.requests.some((request) =>
      request.messages.some((message) => message.content.includes("Gathered evidence:")),
    );
    expect(sawSynthesisPrompt).toBe(true);
  });

  it("treats leaked tool-call markup as no answer and synthesizes instead", async () => {
    const markupAnswer =
      '<|tool_calls|>\n<|invoke name="search_web"><|parameter name="query">x</|parameter>';
    const chatModel = new FakeChatModel([
      [
        {
          content: "",
          isComplete: true,
          toolCalls: [{ id: "1", name: "search_web", arguments: { query: "a", limit: 3 } }],
        },
      ],
      [{ content: markupAnswer, isComplete: true }],
      [{ content: "Real synthesis.", isComplete: true }],
    ]);
    const searchProvider = new FakeSearchProvider([
      {
        source: webSource("https://e.com/x"),
        extractedText: "benchmark text",
        rank: 1,
        query: "a",
      },
    ]);

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider,
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    const result = await runner.run({ task: "What is X?" });

    expect(result.answerText).toBe("Real synthesis.");
    expect(result.answerText).not.toContain("invoke");
  });

  it("emits a diagnostic trace to the injected logger", async () => {
    const events: { type: string }[] = [];
    const chatModel = new FakeChatModel([[{ content: "Answer.", isComplete: true }]]);

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider: new FakeSearchProvider([]),
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
      logger: { logSubAgent: (event) => events.push(event) },
    });

    await runner.run({ task: "What is X?" });

    const types = events.map((event) => event.type);
    expect(types).toContain("session-start");
    expect(types).toContain("loop-complete");
    expect(types).toContain("session-complete");
  });
});

describe("SubAgentRunner cancellation and budgets", () => {
  function searchCallRound(id: string) {
    return {
      items: [
        {
          type: "toolCall" as const,
          call: { id, name: "search_web", arguments: { query: `q-${id}`, limit: 3 } },
        },
      ],
      stopReason: "tool_calls" as const,
    };
  }

  function textRound(text: string) {
    return { items: [{ type: "text" as const, text }], stopReason: "complete" as const };
  }

  function scriptedRounds(
    handler: (request: ModelRoundRequest, index: number) => ModelRoundResult,
  ): ModelRoundProvider & { requests: ModelRoundRequest[] } {
    const requests: ModelRoundRequest[] = [];
    return {
      requests,
      async listModels() {
        return ["m"];
      },
      async runRound(request: ModelRoundRequest) {
        requests.push(request);
        return handler(request, requests.length);
      },
    };
  }

  function webResult(query: string, text = "benchmark text") {
    return { source: webSource("https://e.com/x"), extractedText: text, rank: 1, query };
  }

  it("stops the tool loop on abort and returns an empty answer with a cancelled trace", async () => {
    const controller = new AbortController();
    const searchProvider = {
      async search(query: string) {
        controller.abort();
        return [webResult(query)];
      },
    };
    const modelRound = scriptedRounds((request, index) => {
      if (request.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return index === 1 ? searchCallRound("1") : textRound("never reached");
    });
    const logs: { type: string; reason?: string }[] = [];
    const events: { type: string; message?: string }[] = [];

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider,
      modelRound,
      model: "m",
      logger: { logSubAgent: (event) => logs.push(event) },
    });

    const result = await runner.run({
      task: "What is X?",
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    expect(result.answerText).toBe("");
    expect(modelRound.requests).toHaveLength(1);
    expect(logs.find((entry) => entry.type === "loop-complete")).toMatchObject({
      ok: false,
      reason: "cancelled",
    });
    expect(logs.map((entry) => entry.type)).not.toContain("synthesis-start");
    expect(logs.find((entry) => entry.type === "session-complete")).toMatchObject({
      usedSynthesisFallback: false,
    });
    expect(events.map((event) => event.type)).toEqual([
      SUB_AGENT_PHASE,
      SUB_AGENT_PHASE,
      SUB_AGENT_TOOL_START,
      SUB_AGENT_TOOL_END,
    ]);
    expect(events.map((event) => event.message)).not.toContain("Synthesizing evidence…");
  });

  it("synthesizes from evidence after the round budget is exhausted", async () => {
    const modelRound = scriptedRounds((request, index) => {
      if (request.toolChoice?.type === "none") return textRound("Synthesized from evidence.");
      return searchCallRound(String(index));
    });
    const logs: { type: string; reason?: string; rounds?: number }[] = [];

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider: new FakeSearchProvider([webResult("q-1"), webResult("q-2")]),
      modelRound,
      model: "m",
      logger: { logSubAgent: (event) => logs.push(event) },
    });

    const result = await runner.run({ task: "What is X?", budget: { maxRounds: 2 } });

    expect(result.answerText).toBe("Synthesized from evidence.");
    expect(logs.find((entry) => entry.type === "loop-complete")).toMatchObject({
      ok: false,
      reason: "model-round-limit-exceeded",
      rounds: 2,
    });
    expect(result.snapshot.evidence.length).toBeGreaterThan(0);
  });

  it("replaces tool output with the synthesis stub once the result budget is exceeded", async () => {
    const modelRound = scriptedRounds((_request, index) =>
      index === 1 ? searchCallRound("1") : textRound("Answer within budget."),
    );

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider: new FakeSearchProvider([webResult("q-1", "x".repeat(400))]),
      modelRound,
      model: "m",
    });

    const result = await runner.run({ task: "What is X?", budget: { maxResultChars: 10 } });

    expect(result.answerText).toBe("Answer within budget.");
    const toolMessage = modelRound.requests[1].messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toBe(SYNTHESIS_TOOL_STUB);
    expect(toolMessage?.content).not.toContain("xxxx");
  });

  it("reports a throwing tool as a failed call and still returns the model's answer", async () => {
    const searchProvider = {
      async search(): Promise<never> {
        throw new Error("provider exploded");
      },
    };
    const modelRound = scriptedRounds((_request, index) =>
      index === 1 ? searchCallRound("1") : textRound("Answer despite the failure."),
    );
    const events: { type: string; data?: Record<string, unknown> }[] = [];

    const runner = new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider,
      modelRound,
      model: "m",
    });

    const result = await runner.run({
      task: "What is X?",
      onEvent: (event) => events.push(event),
    });

    expect(result.answerText).toBe("Answer despite the failure.");
    expect(events.find((event) => event.type === SUB_AGENT_TOOL_END)?.data).toMatchObject({
      ok: false,
    });
    expect(result.snapshot.evidence).toHaveLength(0);
  });
});

describe("createResearchToolRegistry run_subagent gating", () => {
  const runner: SubAgentPort = {
    run: async () => ({
      answerText: "",
      snapshot: { evidence: [], citations: [], provenance: [] },
    }),
  };
  const webAvailability = {
    searchMode: "indexAndWeb" as const,
    noteAccess: false,
    activeFileAccess: false,
    noteMutationAccess: false,
    retrieverAvailable: false,
    webProviderAvailable: true,
  };

  it("exposes run_subagent when web is active and a runner + provider are present", () => {
    const created = createResearchToolRegistry({
      availability: webAvailability,
      searchProvider: new FakeSearchProvider([]),
      subAgentRunner: runner,
    });
    expect(created.tools.has("run_subagent")).toBe(true);
  });

  it("omits run_subagent in a fully empty profile (no web/index/notes)", () => {
    const created = createResearchToolRegistry({
      availability: { ...webAvailability, searchMode: "none", webProviderAvailable: false },
      subAgentRunner: runner,
    });
    expect(created.tools.has("run_subagent")).toBe(false);
  });

  it("omits run_subagent without a runner", () => {
    const created = createResearchToolRegistry({
      availability: webAvailability,
      searchProvider: new FakeSearchProvider([]),
    });
    expect(created.tools.has("run_subagent")).toBe(false);
  });

  it("still exposes run_subagent in index-only mode when a retriever is present", () => {
    const created = createResearchToolRegistry({
      availability: { ...webAvailability, searchMode: "indexOnly", retrieverAvailable: true },
      retriever: { search: async () => ({ chunks: [], citations: [], usedFallback: false }) },
      subAgentRunner: runner,
    });
    expect(created.tools.has("run_subagent")).toBe(true);
  });
});

describe("SubAgentRunner telemetry", () => {
  function searchCallRound(id: string) {
    return {
      items: [
        {
          type: "toolCall" as const,
          call: { id, name: "search_web", arguments: { query: `q-${id}`, limit: 3 } },
        },
      ],
      stopReason: "tool_calls" as const,
    };
  }

  function textRound(text: string) {
    return { items: [{ type: "text" as const, text }], stopReason: "complete" as const };
  }

  function scriptedRounds(
    handler: (
      request: ModelRoundRequest,
      index: number,
    ) => ModelRoundResult | Promise<ModelRoundResult>,
  ): ModelRoundProvider {
    let index = 0;
    return {
      async listModels() {
        return ["m"];
      },
      async runRound(request: ModelRoundRequest) {
        index += 1;
        return handler(request, index);
      },
    };
  }

  function webResult(query: string) {
    return {
      source: webSource("https://e.com/x"),
      extractedText: "benchmark text",
      rank: 1,
      query,
    };
  }

  function runnerWith(modelRound: ModelRoundProvider, results = [webResult("q-1")]) {
    return new SubAgentRunner({
      toolsetFactory: createResearchToolRegistry,
      searchProvider: new FakeSearchProvider(results),
      modelRound,
      model: "m",
    });
  }

  it("reports the round limit as a closed failure reason", async () => {
    const runner = runnerWith(
      scriptedRounds((request, index) =>
        request.toolChoice?.type === "none"
          ? textRound("Synthesized.")
          : searchCallRound(String(index)),
      ),
      [webResult("q-1"), webResult("q-2")],
    );

    const result = await runner.run({ task: "What is X?", budget: { maxRounds: 2 } });

    expect(result.telemetry).toMatchObject({
      hitRoundLimit: true,
      failureReason: "model-round-limit-exceeded",
      rounds: 2,
      maxRounds: 2,
      usedSynthesisFallback: true,
    });
    expect(result.telemetry?.runId).toMatch(/\S/);
    expect(typeof result.telemetry?.usage.inputTokens).toBe("number");
  });

  it("splits performed search calls from calls the search budget refused", async () => {
    const runner = runnerWith(
      scriptedRounds((request, index) =>
        request.toolChoice?.type === "none" || index > 2
          ? textRound("Answer.")
          : searchCallRound(String(index)),
      ),
      [webResult("q-1"), webResult("q-2")],
    );

    const result = await runner.run({ task: "What is X?", budget: { maxSearches: 1 } });

    expect(result.answerText).toBe("Answer.");
    expect(result.telemetry).toMatchObject({
      searchCalls: 1,
      maxSearches: 1,
      searchBudgetRejections: 1,
      hitRoundLimit: false,
      toolCalls: 2,
      usedSynthesisFallback: false,
    });
    expect(result.telemetry?.failureReason).toBeUndefined();
  });

  it("keeps the loop duration equal to the run duration without a synthesis pass", async () => {
    const runner = runnerWith(scriptedRounds(() => textRound("Answer.")));

    const result = await runner.run({ task: "What is X?" });

    expect(result.telemetry?.usedSynthesisFallback).toBe(false);
    expect(result.telemetry?.loopDurationMs).toBe(result.telemetry?.durationMs);
    expect(result.telemetry?.answerChars).toBe("Answer.".length);
  });

  it("charges the synthesis pass to the run duration only", async () => {
    const runner = runnerWith(
      scriptedRounds(async (request, index) => {
        if (request.toolChoice?.type === "none") {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return textRound("Synthesized from evidence.");
        }
        return index === 1 ? searchCallRound("1") : textRound("");
      }),
    );

    const result = await runner.run({ task: "What is X?" });

    expect(result.answerText).toBe("Synthesized from evidence.");
    expect(result.telemetry?.usedSynthesisFallback).toBe(true);
    expect(result.telemetry!.loopDurationMs).toBeLessThan(result.telemetry!.durationMs);
  });
});

describe("SubAgentTool telemetry", () => {
  const emptySnapshot = { evidence: [], citations: [], provenance: [] };

  function telemetry(overrides: Partial<SubAgentTelemetry> = {}): SubAgentTelemetry {
    return {
      runId: "run-1",
      durationMs: 120,
      loopDurationMs: 100,
      rounds: 3,
      maxRounds: 12,
      hitRoundLimit: false,
      toolCalls: 4,
      duplicateToolCalls: 1,
      searchCalls: 2,
      maxSearches: 8,
      searchBudgetRejections: 0,
      usedSynthesisFallback: false,
      answerChars: 7,
      usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 0 },
      ...overrides,
    };
  }

  it("returns one telemetry record in diagnostic, never in the model-visible value", async () => {
    const runner: SubAgentPort = {
      run: async () => ({ answerText: "Answer.", snapshot: emptySnapshot, telemetry: telemetry() }),
    };
    const tool = new SubAgentTool({ runner, evidence: new ResearchEvidenceRegistry() });

    const result = await tool.execute({ task: "What is X?", maxSearches: 8 }, toolContext());

    expect(result.ok).toBe(true);
    expect(result.diagnostic).toMatchObject({
      runId: "run-1",
      durationMs: 120,
      loopDurationMs: 100,
      searchCalls: 2,
      sourceCount: 0,
      droppedSourceCount: 0,
      evidenceBudgetExhausted: false,
    });
    expect(JSON.stringify(result.ok ? result.value : {})).not.toContain("runId");
  });

  it("still reports one telemetry record when the runner throws", async () => {
    const runner: SubAgentPort = {
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        throw new Error("sub-agent exploded");
      },
    };
    const tool = new SubAgentTool({ runner, evidence: new ResearchEvidenceRegistry() });

    const result = await tool.execute({ task: "What is X?", maxSearches: 8 }, toolContext());

    expect(result.ok).toBe(false);
    expect(result.diagnostic).toMatchObject({
      runId: "call-1",
      failureReason: "tool-exception",
      rounds: 0,
      toolCalls: 0,
      duplicateToolCalls: 0,
      searchCalls: 0,
      searchBudgetRejections: 0,
      hitRoundLimit: false,
      usedSynthesisFallback: false,
      answerChars: 0,
      sourceCount: 0,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    });
    expect(result.diagnostic?.durationMs).toBeGreaterThan(0);
  });
});
