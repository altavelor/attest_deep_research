import {
  resolveThinkingMaxResultChars,
  ThinkingResearchStrategy,
} from "@application/use-cases/research/strategies/ThinkingResearchStrategy";
import type {
  ResearchExecutionContext,
  ResearchStrategyDeps,
  ResearchStrategyOutcome,
} from "@application/use-cases/research/strategies/ResearchStrategy";
import type { ResearchStreamEvent } from "@application/contracts/research";
import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import type {
  ModelRoundProvider,
  ModelRoundRequest,
  ModelRoundResult,
  ToolCallingCapabilities,
} from "@core/agent";
import type { ResearchExecutionPolicy } from "@core/research";
import { researchModeRetrievalParameters } from "@core/research";
import { fixedNow } from "../helpers/factories";
import type { SearchProvider } from "@application/ports";
import type { ContextDiagnostics } from "@core/diagnostics";

const CAPABILITIES: ToolCallingCapabilities = {
  calls: true,
  choiceRequired: true,
  choiceSpecific: true,
  parallelCalls: true,
};

const POLICY: ResearchExecutionPolicy = {
  strategy: "thinking",
  reason: "thinking-eligible",
  requiredTools: [],
  bootstrapChoice: { type: "auto" },
  parallelToolCalls: true,
  supportsSpecificChoice: true,
};

function emptyRetriever() {
  return { search: async () => ({ chunks: [], citations: [], usedFallback: false }) };
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

function strategy(
  modelRound: ModelRoundProvider,
  searchProvider?: SearchProvider,
  overrides: Partial<ResearchStrategyDeps> = {},
): ThinkingResearchStrategy {
  const deps = {
    ...(searchProvider ? { searchProvider } : {}),
    chatModelName: "m",
    chatOptions: {},
    modelRound,
    modelRoundFactory: () => modelRound,
    retriever: emptyRetriever(),
    evidenceLimit: 5,
    toolsetFactory: createResearchToolRegistry,
    toolsEnabled: true,
    toolCapabilities: CAPABILITIES,
    now: fixedNow,
    ...overrides,
  } as unknown as ResearchStrategyDeps;
  return new ThinkingResearchStrategy(deps);
}

function context(
  overrides: Partial<ResearchExecutionContext["request"]> = {},
): ResearchExecutionContext {
  const searchMode = overrides.searchMode ?? "indexOnly";
  return {
    request: {
      question: "What is X?",
      mode: "thinking",
      searchMode: "indexOnly",
      includeContextDiagnostics: true,
      ...overrides,
    },
    question: "What is X?",
    searchMode,
    retrieval: researchModeRetrievalParameters("thinking"),
    policy: POLICY,
  };
}

async function drain(
  generator: AsyncGenerator<ResearchStreamEvent, ResearchStrategyOutcome>,
): Promise<{ events: ResearchStreamEvent[]; outcome: ResearchStrategyOutcome }> {
  const events: ResearchStreamEvent[] = [];
  let next = await generator.next();
  while (!next.done) {
    events.push(next.value);
    next = await generator.next();
  }
  return { events, outcome: next.value };
}

describe("ThinkingResearchStrategy failure paths", () => {
  it("keeps a safe minimum output budget while respecting bounded context capacity", () => {
    expect(resolveThinkingMaxResultChars({ usedTokens: 0 })).toBe(80_000);
    expect(resolveThinkingMaxResultChars({ contextLimitTokens: 10, usedTokens: 20 })).toBe(80_000);
    expect(resolveThinkingMaxResultChars({ contextLimitTokens: 2_000_000, usedTokens: 0 })).toBe(
      1_000_000,
    );
  });
  it("returns a cancelled outcome and no answer when the run is aborted mid-stream", async () => {
    const controller = new AbortController();
    const modelRound = scriptedRounds((request, index) => {
      if (index === 1) {
        request.onDelta?.({ type: "text", text: "partial answer" });
        controller.abort();
        return {
          items: [
            {
              type: "toolCall" as const,
              call: { id: "1", name: "search_index", arguments: { query: "x" } },
            },
          ],
          stopReason: "tool_calls" as const,
        };
      }
      return { items: [{ type: "text" as const, text: "late" }], stopReason: "complete" as const };
    });

    const { events, outcome } = await drain(
      strategy(modelRound).execute(context({ signal: controller.signal })),
    );

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(events).toContainEqual({
      type: "checkpoint-delta",
      checkpointId: "round-1",
      round: 1,
      content: "partial answer",
    });
    expect(modelRound.requests).toHaveLength(1);
  });

  it("returns a failed outcome with an empty answer when answer synthesis fails", async () => {
    const modelRound = scriptedRounds((_request, index) =>
      index === 1
        ? {
            items: [
              {
                type: "toolCall" as const,
                call: { id: "1", name: "search_index", arguments: { query: "x" } },
              },
            ],
            stopReason: "tool_calls" as const,
          }
        : { items: [], stopReason: "error" as const },
    );

    const { events, outcome } = await drain(strategy(modelRound).execute(context()));

    expect(modelRound.requests).toHaveLength(2);
    expect(events.find((event) => event.type === "tool-call-end")).toMatchObject({ ok: true });
    expect(outcome).toMatchObject({
      kind: "failed",
      failure: { ok: false, reason: "provider-error" },
      answer: { answer: "", citations: [], evidence: [] },
    });
    expect(events.some((event) => event.type === "complete")).toBe(false);
    if (outcome.kind !== "failed") return;
    expect(outcome.diagnostics).toMatchObject({
      executionStrategy: "instant-fallback",
      answer: { citations: { verificationRan: false } },
      thinking: { fallbackReason: "provider-error" },
    });
  });

  it("falls back without calling the model when the thinking prompt exceeds the context limit", async () => {
    const modelRound = scriptedRounds(() => ({
      items: [{ type: "text" as const, text: "must not run" }],
      stopReason: "complete" as const,
    }));

    const { events, outcome } = await drain(
      strategy(modelRound, undefined, { contextLimitTokens: 1 }).execute(context()),
    );

    expect(modelRound.requests).toHaveLength(0);
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(outcome).toMatchObject({
      kind: "failed",
      failure: { ok: false, reason: "context-limit-exceeded" },
      diagnostics: {
        executionStrategy: "instant-fallback",
        thinking: { fallbackReason: "context-limit-exceeded" },
      },
    });
  });

  it("completes with an empty citation set when retrieval returns nothing", async () => {
    const modelRound = scriptedRounds((_request, index) =>
      index === 1
        ? {
            items: [
              {
                type: "toolCall" as const,
                call: { id: "1", name: "search_index", arguments: { query: "x" } },
              },
            ],
            stopReason: "tool_calls" as const,
          }
        : {
            items: [{ type: "text" as const, text: "No sources found." }],
            stopReason: "complete" as const,
          },
    );

    const { events, outcome } = await drain(strategy(modelRound).execute(context()));

    expect(outcome).toEqual({ kind: "completed" });
    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({
      answer: { answer: "No sources found.", citations: [], evidence: [] },
    });
    expect(events.find((event) => event.type === "tool-call-end")).toMatchObject({ ok: true });
  });

  it("records unknown citation ids in diagnostics without presenting them as verified evidence", async () => {
    const modelRound = scriptedRounds(() => ({
      items: [{ type: "text" as const, text: "The source says this [missing-source]." }],
      stopReason: "complete" as const,
    }));

    const { events, outcome } = await drain(strategy(modelRound).execute(context()));

    expect(outcome).toEqual({ kind: "completed" });
    expect(events.find((event) => event.type === "complete")).toMatchObject({
      answer: {
        answer: "The source says this [missing-source].",
        citations: [],
        contextDiagnostics: {
          thinking: { unknownCitationIds: ["missing-source"] },
          answer: {
            citations: {
              verificationRan: true,
              unknownCitationIds: ["missing-source"],
            },
          },
        },
      },
    });
  });

  it("adds active-note evidence before the model runs and exposes a cited note in the answer", async () => {
    const modelRound = scriptedRounds(() => ({
      items: [
        {
          type: "text" as const,
          text: "The active note is relevant [active-1] [active-1].",
        },
      ],
      stopReason: "complete" as const,
    }));
    const noteTools = {
      execute: vi.fn(async () => ({
        ok: true,
        result: JSON.stringify({
          chunks: [
            {
              id: "active-1",
              text: "A relevant note.",
              evidenceSource: {
                id: "active-source",
                kind: "markdown",
                title: "Active note",
                path: "Notes/Active.md",
                headingPath: [],
              },
            },
          ],
        }),
      })),
      mutationEnabled: () => false,
      setCitationProvider: vi.fn(),
    };

    const { events, outcome } = await drain(
      strategy(modelRound, undefined, { noteTools: noteTools as never }).execute(
        context({ includeActiveFile: true, activeFilePath: "Notes/Active.md" }),
      ),
    );

    expect(noteTools.execute).toHaveBeenCalledWith({
      id: "active-note-prefetch",
      name: "get_active_note",
      arguments: {},
    });
    expect(outcome).toEqual({ kind: "completed" });
    expect(events.find((event) => event.type === "complete")).toMatchObject({
      answer: {
        answer: "The active note is relevant [active-1].",
        evidence: [{ id: "active-1" }],
        citations: [{ id: "active-1" }],
        contextDiagnostics: {
          answer: {
            citations: {
              occurrences: 2,
              uniqueLabels: 1,
              byLabel: { "active-1": 2 },
              uncitedPromptSourceIds: [],
              collapsedOccurrences: 1,
              verificationRan: true,
            },
          },
        },
      },
    });
  });
});

describe("ThinkingResearchStrategy citation normalization", () => {
  const webSource = {
    id: "c1",
    kind: "web" as const,
    title: "Pricing",
    url: "https://openai.com/pricing",
    snippet: "",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    wasContentFetched: true,
  };

  function webRetriever() {
    const chunk = {
      id: "c1",
      text: "GPT-4o costs $2.50 per 1M input tokens.",
      score: 1,
      contentHash: "c1",
      source: webSource,
    };
    return {
      search: async () => ({
        chunks: [chunk],
        citations: [{ id: "c1", source: webSource }],
        usedFallback: false,
      }),
    };
  }

  function answering(text: string): ModelRoundProvider & { requests: ModelRoundRequest[] } {
    return scriptedRounds((_request, index) =>
      index === 1
        ? {
            items: [
              {
                type: "toolCall" as const,
                call: { id: "1", name: "search_index", arguments: { query: "x" } },
              },
            ],
            stopReason: "tool_calls" as const,
          }
        : { items: [{ type: "text" as const, text }], stopReason: "complete" as const },
    );
  }

  function strategyWithWebEvidence(modelRound: ModelRoundProvider): ThinkingResearchStrategy {
    const deps = {
      chatModelName: "m",
      chatOptions: {},
      modelRound,
      modelRoundFactory: () => modelRound,
      retriever: webRetriever(),
      evidenceLimit: 5,
      toolsetFactory: createResearchToolRegistry,
      toolsEnabled: true,
      toolCapabilities: CAPABILITIES,
      now: fixedNow,
    } as unknown as ResearchStrategyDeps;
    return new ThinkingResearchStrategy(deps);
  }

  it("resolves a url handle to its evidence id and cites it", async () => {
    const modelRound = answering("GPT-4o costs $2.50 [url:https://openai.com/pricing].");

    const { events } = await drain(strategyWithWebEvidence(modelRound).execute(context()));

    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({
      answer: {
        answer: "GPT-4o costs $2.50 [c1].",
        citations: [{ id: "c1" }],
      },
    });
    expect((complete as { answer: { webReferences?: unknown } }).answer.webReferences).toBe(
      undefined,
    );
  });

  it("records a cited page without evidence as a web reference, not as evidence", async () => {
    const modelRound = answering(
      "Costs $2.50 [url:https://openai.com/pricing] but see [url:https://example.com/unseen].",
    );

    const { events } = await drain(strategyWithWebEvidence(modelRound).execute(context()));

    const complete = events.find((event) => event.type === "complete");
    expect(complete).toMatchObject({
      answer: {
        answer: "Costs $2.50 [c1] but see [web-ref-1].",
        citations: [{ id: "c1" }],
        webReferences: [{ id: "web-ref-1", url: "https://example.com/unseen" }],
      },
    });
    if (complete?.type !== "complete") throw new Error("no completion");
    expect(complete.answer.evidence?.map((chunk) => chunk.id)).toEqual(["c1"]);
    expect(complete.answer.citations.map((citation) => citation.id)).toEqual(["c1"]);
  });
});

describe("ThinkingResearchStrategy web source tracing", () => {
  function tracingSearchProvider(): SearchProvider {
    return {
      search: async (query, options) => {
        options?.onSourceSelection?.({
          mode: "thinking",
          deadlineMs: options.deadlineMs ?? 0,
          perSourceLimit: options.perSourceLimit ?? 0,
          deadlineExceeded: false,
          cancelled: false,
          intent: "academic",
          intentOrigin: "model",
          sources: [
            {
              sourceId: "arxiv",
              label: "arXiv",
              activation: "auto",
              outcome: "queried",
              queryOrder: 1,
              returnedResults: 0,
            },
          ],
        });
        void query;
        return [];
      },
    };
  }

  function searchWebRounds(queries: readonly string[]) {
    return scriptedRounds((_request, index) => {
      if (index === 1) {
        return {
          items: queries.map((query, position) => ({
            type: "toolCall" as const,
            call: {
              id: `web-${position}`,
              name: "search_web",
              arguments: { query, limit: 5 },
            },
          })),
          stopReason: "tool_calls" as const,
        };
      }
      return { items: [{ type: "text" as const, text: "done" }], stopReason: "complete" as const };
    });
  }

  async function runWithSearches(queries: readonly string[]): Promise<ContextDiagnostics> {
    const { events } = await drain(
      strategy(searchWebRounds(queries), tracingSearchProvider()).execute(
        context({ searchMode: "indexAndWeb" }),
      ),
    );
    const contextEvent = events.find((event) => event.type === "context");
    expect(contextEvent).toBeDefined();
    return (contextEvent as { diagnostics: ContextDiagnostics }).diagnostics;
  }

  it("records one selection block per search_web call, tagged with its query", async () => {
    const diagnostics = await runWithSearches(["rag papers", "vector databases"]);

    expect(diagnostics.webSourceSelections).toHaveLength(2);
    expect(diagnostics.webSourceSelections?.map((entry) => entry.query)).toEqual([
      "rag papers",
      "vector databases",
    ]);
    expect(diagnostics.webSourceSelections?.[0]).toMatchObject({
      intent: "academic",
      intentOrigin: "model",
    });
  });

  it("passes the thinking mode's web deadline down to the search tool", async () => {
    const diagnostics = await runWithSearches(["rag papers"]);
    const expected = researchModeRetrievalParameters("thinking").web;

    expect(diagnostics.webSourceSelections?.[0]).toMatchObject({
      deadlineMs: expected.deadlineMs,
      perSourceLimit: expected.perSourceLimit,
    });
  });

  it("reports the planned source labels on each web-search tool call", async () => {
    const provider = {
      ...tracingSearchProvider(),
      searchSourceLabels: vi.fn(() => ["arXiv", "Crossref"]),
    };
    const { events } = await drain(
      strategy(
        scriptedRounds((_request, index) =>
          index === 1
            ? {
                items: [
                  {
                    type: "toolCall" as const,
                    call: {
                      id: "web-labels",
                      name: "search_web",
                      arguments: { query: "rag papers", category: "academic", recency: "month" },
                    },
                  },
                ],
                stopReason: "tool_calls" as const,
              }
            : { items: [{ type: "text" as const, text: "done" }], stopReason: "complete" as const },
        ),
        provider,
      ).execute(context({ searchMode: "indexAndWeb" })),
    );

    expect(events.find((event) => event.type === "tool-call-start")).toMatchObject({
      searchSources: ["arXiv", "Crossref"],
    });
    expect(provider.searchSourceLabels).toHaveBeenCalledWith("rag papers", {
      intent: "academic",
      recency: "month",
    });
  });

  it("does not carry selections between runs", async () => {
    const first = await runWithSearches(["rag papers"]);
    const second = await runWithSearches(["vector databases"]);

    expect(first.webSourceSelections).toHaveLength(1);
    expect(second.webSourceSelections).toHaveLength(1);
    expect(second.webSourceSelections?.[0].query).toBe("vector databases");
  });

  it("caps the traced searches and reports how many were omitted", async () => {
    const queries = Array.from({ length: 23 }, (_unused, index) => `query ${index}`);
    const diagnostics = await runWithSearches(queries);

    expect(diagnostics.webSourceSelections).toHaveLength(20);
    expect(diagnostics.omittedWebSourceSelections).toBe(3);
    expect(diagnostics.webSourceSelections?.at(-1)?.query).toBe("query 19");
  });

  it("omits the field entirely when the run performs no web search", async () => {
    const { events } = await drain(
      strategy(
        scriptedRounds(() => ({
          items: [{ type: "text" as const, text: "done" }],
          stopReason: "complete" as const,
        })),
        tracingSearchProvider(),
      ).execute(context({ searchMode: "indexAndWeb" })),
    );
    const contextEvent = events.find((event) => event.type === "context");
    const diagnostics = (contextEvent as { diagnostics: ContextDiagnostics }).diagnostics;

    expect(diagnostics.webSourceSelections).toBeUndefined();
  });
});

describe("ThinkingResearchStrategy media tool availability", () => {
  it("offers image search when an enabled external image source is configured", async () => {
    const rounds = scriptedRounds(() => ({
      items: [{ type: "text" as const, text: "done" }],
      stopReason: "complete" as const,
    }));
    const imageSearch = {
      enabledImageSources: () => [
        { descriptor: { id: "commons", label: "Commons" }, searchImages: async () => [] },
      ],
    };

    await drain(
      strategy(rounds, undefined, { imageSearch: imageSearch as never }).execute(context()),
    );

    expect(rounds.requests[0]?.tools?.map((tool) => tool.function.name)).toContain("search_images");
  });

  it("offers image search for indexed document images without enabling a web image source", async () => {
    const rounds = scriptedRounds(() => ({
      items: [{ type: "text" as const, text: "done" }],
      stopReason: "complete" as const,
    }));
    const documentImageCandidates = vi.fn(async () => []);

    await drain(
      strategy(rounds, undefined, {
        documentImageCandidates,
      }).execute(context({ contextPaths: ["Notes/diagram.md"] })),
    );

    expect(rounds.requests[0]?.tools?.map((tool) => tool.function.name)).toContain("search_images");
    expect(documentImageCandidates).not.toHaveBeenCalled();
  });
});
