import {
  extractResultHint,
  formatCount,
  groupToolCalls,
  isEmptySearchResult,
  isNoteworthyRound,
  toolCallSummary,
  webSourceSelectionHtml,
  webSourceSelectionsHtml,
} from "@apps/obsidian/ui/diagnostics/report/format";
import {
  buildReasoningSection,
  buildRequestSection,
} from "@apps/obsidian/ui/diagnostics/report/sections";
import { ThinkingLoopRound } from "@apps/obsidian/ui/diagnostics/report/types";
import {
  ContextDiagnostics,
  ToolCallDiagnostic,
  WebSourceSelectionDiagnostics,
} from "@core/diagnostics";

function call(overrides: Partial<ToolCallDiagnostic>): ToolCallDiagnostic {
  return {
    id: "1",
    name: "search_web",
    status: "success",
    arguments: {},
    round: 1,
    ...overrides,
  };
}

function round(overrides: Partial<ThinkingLoopRound>): ThinkingLoopRound {
  return {
    round: 1,
    phase: "research",
    promptDelta: null,
    toolCalls: [],
    reasoningSegments: [],
    hadTextOutput: false,
    classification: null,
    ...overrides,
  };
}

describe("buildReasoningSection tool-loop reconciliation", () => {
  it("reports tool calls recorded in d.tools even when the loop counters are hardcoded to 0", () => {
    const diagnostics = {
      thinking: {
        policyReason: "instant-selected",
        requiredTools: [],
        bootstrapChoice: { type: "auto" },
        satisfiedTools: [],
        repairedTools: [],
        rounds: 0,
        totalCalls: 0,
        duplicateCalls: 0,
        duplicatedCost: false,
      },
      tools: [
        call({ id: "a", round: 1 }),
        call({ id: "b", round: 1 }),
        call({ id: "c", round: 2 }),
      ],
    } as unknown as ContextDiagnostics;

    const section = buildReasoningSection(diagnostics);

    expect(section.thinkingLoop?.totalCalls).toBe(3);
    expect(section.thinkingLoop?.totalRounds).toBe(2);
  });

  it("keeps the strategy-reported counters when they already exceed the tool count", () => {
    const diagnostics = {
      thinking: {
        policyReason: "thinking-selected",
        requiredTools: [],
        bootstrapChoice: { type: "auto" },
        satisfiedTools: [],
        repairedTools: [],
        rounds: 3,
        totalCalls: 5,
        duplicateCalls: 0,
        duplicatedCost: false,
      },
      tools: [call({ id: "a", round: 1 })],
    } as unknown as ContextDiagnostics;

    const section = buildReasoningSection(diagnostics);

    expect(section.thinkingLoop?.totalCalls).toBe(5);
    expect(section.thinkingLoop?.totalRounds).toBe(3);
  });
});

describe("diagnostic report format helpers", () => {
  it("detects an empty keyword search result", () => {
    const empty = call({
      resultPreview: '{"ok":true,"results":[],"diagnostics":{"hint":"retry with 2-4 keywords"}}',
    });
    expect(isEmptySearchResult(empty)).toBe(true);
    expect(isEmptySearchResult(call({ resultPreview: '{"results":[{"url":"x"}]}' }))).toBe(false);

    expect(
      isEmptySearchResult(call({ name: "fetch_web_page", resultPreview: '"results":[]' })),
    ).toBe(false);
    expect(extractResultHint(empty)).toBe("retry with 2-4 keywords");
  });

  it("aggregates a round's calls into a one-line summary", () => {
    const calls = [
      call({ name: "fetch_web_page" }),
      call({ name: "fetch_web_page" }),
      call({ resultPreview: '"results":[]' }),
      call({ resultPreview: '"results":[]' }),
    ];
    expect(toolCallSummary(calls)).toBe("2× fetch_web_page · 2× search_web ∅");
    expect(toolCallSummary([])).toBe("no tool calls");
    expect(groupToolCalls([call({ status: "failed" })])[0].failed).toBe(1);
  });

  it("auto-expands only noteworthy rounds", () => {
    expect(isNoteworthyRound(round({ toolCalls: [call({ status: "failed" })] }))).toBe(true);
    expect(isNoteworthyRound(round({ toolCalls: [call({ resultPreview: '"results":[]' })] }))).toBe(
      true,
    );
    expect(isNoteworthyRound(round({ hadTextOutput: true }))).toBe(true);
    expect(
      isNoteworthyRound(round({ toolCalls: [call({ resultPreview: '"results":[1]' })] })),
    ).toBe(false);
  });

  it("formats large counts compactly", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(74_499)).toBe("74.5k");
    expect(formatCount(1_048_576)).toBe("1.0M");
  });
});

describe("web source selection rendering", () => {
  const selection = {
    mode: "thinking",
    deadlineMs: 8_000,
    perSourceLimit: 5,
    mergedLimit: 12,
    deadlineExceeded: true,
    cancelled: false,
    intent: "news",
    intentOrigin: "model",
    intentReason: "question asks for recent events",
    language: "ru",
    sources: [
      {
        sourceId: "tavily",
        label: "Tavily",
        activation: "always",
        outcome: "queried",
        queryOrder: 2,
        returnedResults: 7,
        promptResults: 3,
        durationMs: 1_500,
      },
      {
        sourceId: "hn",
        label: "Hacker News",
        activation: "auto",
        outcome: "intent-filtered",
        reason: "no signal for intent: news",
      },
      {
        sourceId: "arxiv",
        label: "arXiv",
        activation: "auto",
        outcome: "health-skipped",
        queryOrder: 1,
        reason: "circuit open",
      },
    ],
  } satisfies WebSourceSelectionDiagnostics;

  it("renders limits, deadline state, intent and every source outcome", () => {
    const html = webSourceSelectionHtml(selection);

    expect(html).toContain("Web source selection");
    expect(html).toContain("thinking");
    expect(html).toContain("Per-source limit");
    expect(html).toContain(">5<");
    expect(html).toContain("Merged limit");
    expect(html).toContain(">12<");
    expect(html).toContain("8.0 s");
    expect(html).toContain("exceeded");
    expect(html).toContain("news");
    expect(html).toContain("model");
    expect(html).toContain("question asks for recent events");
    expect(html).toContain("Tavily");
    expect(html).toContain("queried");
    expect(html).toContain("health-skipped");
    expect(html).toContain("intent-filtered");
    expect(html).toContain("no signal for intent: news");
    expect(html).toContain("1.5 s");
    expect(html.indexOf("arXiv")).toBeLessThan(html.indexOf("Tavily"));
    expect(html.indexOf("Tavily")).toBeLessThan(html.indexOf("Hacker News"));
  });

  it("renders nothing when the run carries no source selection", () => {
    expect(webSourceSelectionHtml(undefined)).toBe("");
    expect(webSourceSelectionHtml(null)).toBe("");
  });

  it("renders one block per Thinking search, labelled with its query", () => {
    const html = webSourceSelectionsHtml([
      { ...selection, query: "recent AI news" },
      { ...selection, query: "arxiv retrieval augmentation", intent: "academic" },
    ]);

    expect(html.match(/Web source selection/g)).toHaveLength(2);
    expect(html).toContain("recent AI news");
    expect(html).toContain("arxiv retrieval augmentation");
    expect(html.indexOf("recent AI news")).toBeLessThan(
      html.indexOf("arxiv retrieval augmentation"),
    );
  });

  it("notes how many Thinking searches were left untraced", () => {
    const html = webSourceSelectionsHtml([{ ...selection, query: "q" }], 4);
    expect(html).toContain("1 of 5 searches traced");
    expect(webSourceSelectionsHtml([{ ...selection, query: "q" }])).not.toContain(
      "searches traced",
    );
  });

  it("renders nothing for an empty or missing Thinking selection list", () => {
    expect(webSourceSelectionsHtml([])).toBe("");
    expect(webSourceSelectionsHtml(undefined)).toBe("");
    expect(webSourceSelectionsHtml(null)).toBe("");
  });

  it("carries Thinking selections into the request section", () => {
    const section = buildRequestSection({
      webSourceSelections: [{ ...selection, query: "q" }],
    } as unknown as ContextDiagnostics);
    expect(section.webSourceSelections).toHaveLength(1);
    expect(buildRequestSection({} as ContextDiagnostics).webSourceSelections).toBeNull();
  });

  it("carries source selection into the request section and omits it when absent", () => {
    const withSelection = buildRequestSection({
      web: { results: [], queries: [], sourceSelection: selection },
    } as unknown as ContextDiagnostics);
    expect(withSelection.webSourceSelection).toEqual(selection);

    const without = buildRequestSection({
      web: { results: [], queries: [] },
    } as unknown as ContextDiagnostics);
    expect(without.webSourceSelection).toBeNull();
    expect(buildRequestSection({} as ContextDiagnostics).webSourceSelection).toBeNull();
  });
});
