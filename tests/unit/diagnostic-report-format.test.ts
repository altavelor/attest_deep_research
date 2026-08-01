import {
  extractResultHint,
  formatCount,
  groupToolCalls,
  isEmptySearchResult,
  isNoteworthyRound,
  toolCallSummary,
} from "@apps/obsidian/ui/diagnostics/report/format";
import { buildReasoningSection } from "@apps/obsidian/ui/diagnostics/report/sections";
import { ThinkingLoopRound } from "@apps/obsidian/ui/diagnostics/report/types";
import { ContextDiagnostics, ToolCallDiagnostic } from "@core/diagnostics";

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
    // Content-bearing tools are never "empty searches".
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
