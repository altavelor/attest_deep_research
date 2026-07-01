import { parseDeepResearchDirective } from "@core/research";
import {
  DeepResearchReport,
  formatDeepResearchReport,
  remapReportEvidenceIds,
} from "@core/research";
import { parseDeepResearchReport } from "@application/use-cases/research/deep-research/parseDeepResearchReport";
import { DeepResearchAgent } from "@application/use-cases/research/deep-research/DeepResearchAgent";
import { DeepSearchTool } from "@adapters/research-tools/deep-research/DeepSearchTool";
import { DeepResearchRunner } from "@application/research";
import { createResearchToolRegistry } from "@adapters/research-tools/createResearchToolRegistry";
import { ResearchEvidenceRegistry } from "@adapters/research-tools/ResearchEvidenceRegistry";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { FakeChatModel, FakeSearchProvider } from "../helpers/researchFakes";
import { retrieved, webSource } from "../helpers/factories";
import type { ToolContext } from "@core/agent";

function toolContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    callId: "call-1",
    signal: new AbortController().signal,
    emit: () => {},
    ...overrides,
  };
}

describe("parseDeepResearchDirective", () => {
  it("detects and strips a standalone @deep_search mention", () => {
    const result = parseDeepResearchDirective("@deep_search what changed in v2?");
    expect(result.forceDeepSearch).toBe(true);
    expect(result.cleanedQuestion).toBe("what changed in v2?");
  });

  it("strips a mid-sentence mention and collapses whitespace", () => {
    const result = parseDeepResearchDirective("compare @deep_search the two libraries");
    expect(result.forceDeepSearch).toBe(true);
    expect(result.cleanedQuestion).toBe("compare the two libraries");
  });

  it("leaves a question without the mention untouched", () => {
    const result = parseDeepResearchDirective("deep search of my notes");
    expect(result.forceDeepSearch).toBe(false);
    expect(result.cleanedQuestion).toBe("deep search of my notes");
  });
});

describe("deep research report formatting", () => {
  const report: DeepResearchReport = {
    question: "Q",
    summary: "It depends [a].",
    findings: [
      { claim: "X is true", reliability: "high", sourceEvidenceIds: ["a", "missing"] },
    ],
    contradictions: ["src disagree"],
    uncertainties: ["unknown Y"],
  };

  it("remaps sub-agent evidence ids and drops unmapped ones", () => {
    const remapped = remapReportEvidenceIds(report, new Map([["a", "web:1"]]));
    expect(remapped.findings[0].sourceEvidenceIds).toEqual(["web:1"]);
  });

  it("formats findings, sections and a sources list", () => {
    const text = formatDeepResearchReport(report, [
      { evidenceId: "a", title: "Title", url: "https://e.com/a" },
    ]);
    // The question is echoed in the tool-result envelope, not repeated in the
    // report body — repeating it only burns the agentic tool-result budget.
    expect(text).not.toContain("Deep research report for:");
    expect(text.startsWith("Summary:")).toBe(true);
    // Sources are cited by their URL (`[url:…]`), not by the opaque evidence id.
    expect(text).toContain("(high) X is true [url:https://e.com/a]");
    expect(text).toContain("Contradictions");
    expect(text).toContain("- Title — https://e.com/a");
    expect(text).not.toContain("[a]");
  });

  it("never leaks an unresolved evidence-id/hash citation to the parent", () => {
    // The sub-agent cites ids that did not survive remap: a raw web:<hash>, an abbreviated
    // hex id, plus a non-citation bracket that must be preserved.
    const leaky: DeepResearchReport = {
      question: "Q",
      summary: "Gemini is 1M [web:d526cb16dead] and fast [9c7dd856]; see the [note] below.",
      findings: [
        { claim: "Priced low [web:abcdef0]", reliability: "medium", sourceEvidenceIds: ["a", "web:unmapped"] },
      ],
      contradictions: [],
      uncertainties: [],
    };
    const text = formatDeepResearchReport(leaky, [
      { evidenceId: "a", title: "T", url: "https://e.com/a" },
    ]);
    expect(text).not.toContain("web:");
    expect(text).not.toContain("9c7dd856");
    expect(text).not.toContain("abcdef0");
    // Resolvable cite still rendered; ordinary prose bracket preserved.
    expect(text).toContain("[url:https://e.com/a]");
    expect(text).toContain("[note]");
  });

  it("resolves a prefix-wrapped handle and drops an unresolvable one", () => {
    // Models sometimes wrap the handle: `[evidenceId:web:…]`. The wrapper must be stripped
    // so a registered handle becomes a URL cite, and an unregistered one is dropped — never
    // leaked raw.
    const wrapped: DeepResearchReport = {
      question: "Q",
      summary: "Priced low [evidenceId:web:known] and [id:web:gone] too.",
      findings: [],
      contradictions: [],
      uncertainties: [],
    };
    const text = formatDeepResearchReport(wrapped, [
      { evidenceId: "web:known", title: "T", url: "https://e.com/k" },
    ]);
    expect(text).toContain("[url:https://e.com/k]");
    expect(text).not.toContain("web:");
    expect(text).not.toContain("evidenceId:");
  });

  it("drops gathered sources that no finding or summary cites", () => {
    const text = formatDeepResearchReport(report, [
      { evidenceId: "a", title: "Cited", url: "https://e.com/a" },
      { evidenceId: "z", title: "Uncited", url: "https://e.com/z" },
    ]);
    expect(text).toContain("- Cited — https://e.com/a");
    // The uncited source is noise for the parent's budget — it must not appear.
    expect(text).not.toContain("https://e.com/z");
    expect(text).not.toContain("Uncited");
  });
});

describe("parseDeepResearchReport", () => {
  it("parses a fenced JSON block into a structured report", () => {
    const raw = [
      "Here is the evidence.",
      "```json",
      JSON.stringify({
        summary: "Done [x].",
        findings: [{ claim: "A", reliability: "medium", sourceEvidenceIds: ["x"] }],
        contradictions: [],
        uncertainties: ["maybe B"],
      }),
      "```",
    ].join("\n");

    const report = parseDeepResearchReport("Q", raw);
    expect(report.summary).toBe("Done [x].");
    expect(report.findings).toEqual([
      { claim: "A", reliability: "medium", sourceEvidenceIds: ["x"] },
    ]);
    expect(report.uncertainties).toEqual(["maybe B"]);
  });

  it("degrades to a summary-only report when no JSON is present", () => {
    const report = parseDeepResearchReport("Q", "free text answer with no json");
    expect(report.summary).toBe("free text answer with no json");
    expect(report.findings).toEqual([]);
  });

  it("never lets leaked tool-call markup become the summary", () => {
    const markup = 'Summary:\n<|tool_calls|>\n<|invoke name="search_web"><|parameter name="query">x</|parameter>';
    const report = parseDeepResearchReport("Q", markup);
    expect(report.summary).toBe("");
    expect(report.findings).toEqual([]);
  });

  it("defaults an invalid reliability to low and skips empty claims", () => {
    const raw = JSON.stringify({
      summary: "s",
      findings: [
        { claim: "kept", reliability: "bogus", sourceEvidenceIds: [] },
        { claim: "", reliability: "high" },
      ],
    });
    const report = parseDeepResearchReport("Q", raw);
    expect(report.findings).toEqual([{ claim: "kept", reliability: "low", sourceEvidenceIds: [] }]);
  });
});

describe("DeepSearchTool", () => {
  const reportFromRunner: DeepResearchReport = {
    question: "How fast is X?",
    summary: "Fast [sub-1].",
    findings: [{ claim: "X is fast", reliability: "high", sourceEvidenceIds: ["sub-1"] }],
    contradictions: [],
    uncertainties: [],
  };

  function stubRunner(emitted: unknown[]): DeepResearchRunner {
    return {
      run: async (input) => {
        input.onEvent?.({ type: "deep-research-phase", message: "Searching…" });
        emitted.push("ran");
        return {
          report: reportFromRunner,
          snapshot: {
            evidence: [retrieved("sub-1", webSource("https://e.com/x"), "X benchmark text")],
            citations: [],
            provenance: [],
          },
        };
      },
    };
  }

  it("re-registers sub-agent evidence into the parent registry and cites parent ids", async () => {
    const emitted: unknown[] = [];
    const evidence = new ResearchEvidenceRegistry();
    const tool = new DeepSearchTool({ runner: stubRunner(emitted), evidence });

    const result = await tool.execute({ question: "How fast is X?" }, toolContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.findingCount).toBe(1);
    expect(result.value.sourceCount).toBe(1);
    // Parent registry now holds the re-registered web source, cited by its URL.
    const parentEvidence = evidence.snapshot().evidence;
    expect(parentEvidence).toHaveLength(1);
    expect(result.value.report).toContain("[url:https://e.com/x]");
    expect(result.value.report).toContain("https://e.com/x");
    // The sub-agent's internal id is remapped, not leaked.
    expect(result.value.report).not.toContain("sub-1");
  });

  it("forwards sub-agent progress through the tool's emit channel", async () => {
    const events: unknown[] = [];
    const tool = new DeepSearchTool({
      runner: stubRunner([]),
      evidence: new ResearchEvidenceRegistry(),
    });

    await tool.execute(
      { question: "q" },
      toolContext({ emit: (event) => events.push(event) }),
    );

    expect(events).toContainEqual({ type: "deep-research-phase", message: "Searching…" });
  });

  it("rejects an empty question", () => {
    const tool = new DeepSearchTool({
      runner: stubRunner([]),
      evidence: new ResearchEvidenceRegistry(),
    });
    const parsed = tool.parseInput({ question: "  " });
    expect(parsed.ok).toBe(false);
  });
});

describe("DeepResearchAgent", () => {
  it("runs a web-only loop and parses the model's structured report", async () => {
    const reportJson = JSON.stringify({
      summary: "Synthesized.",
      findings: [{ claim: "A", reliability: "high", sourceEvidenceIds: [] }],
      contradictions: [],
      uncertainties: [],
    });
    const chatModel = new FakeChatModel([[{ content: reportJson, isComplete: true }]]);

    const availabilities: unknown[] = [];
    const spyFactory: typeof createResearchToolRegistry = (options) => {
      availabilities.push(options.availability);
      return createResearchToolRegistry(options);
    };

    const agent = new DeepResearchAgent({
      toolsetFactory: spyFactory,
      searchProvider: new FakeSearchProvider([]),
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    const result = await agent.run({ question: "What is X?" });

    expect(result.report.summary).toBe("Synthesized.");
    expect(result.report.findings).toHaveLength(1);
    // The sub-agent's toolset is web-only — no index/note tools.
    expect(availabilities[0]).toMatchObject({
      searchMode: "webOnly",
      retrieverAvailable: false,
      noteAccess: false,
      webProviderAvailable: true,
    });
  });

  it("runs a tool-less synthesis pass when the loop ends without a report", async () => {
    const synthesisJson = JSON.stringify({
      summary: "Synthesized from gathered evidence.",
      findings: [{ claim: "A", reliability: "medium", sourceEvidenceIds: [] }],
      contradictions: [],
      uncertainties: [],
    });
    // Round 1 searches (registers web evidence); round 2 ends empty (no text) so the
    // loop returns ok:true with an empty answer; round 3 is the forced synthesis pass.
    const chatModel = new FakeChatModel([
      [{ content: "", isComplete: true, toolCalls: [{ id: "1", name: "search_web", arguments: { query: "a", limit: 3 } }] }],
      [{ content: "", isComplete: true }],
      [{ content: synthesisJson, isComplete: true }],
    ]);
    const searchProvider = new FakeSearchProvider([
      { source: webSource("https://e.com/x"), extractedText: "benchmark text", rank: 1, query: "a" },
    ]);

    const agent = new DeepResearchAgent({
      toolsetFactory: createResearchToolRegistry,
      searchProvider,
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    const result = await agent.run({ question: "What is X?" });

    expect(result.report.summary).toBe("Synthesized from gathered evidence.");
    expect(result.report.findings).toHaveLength(1);
    // The synthesis pass was fed the already-gathered evidence.
    const sawSynthesisPrompt = chatModel.requests.some((request) =>
      request.messages.some((message) => message.content.includes("Gathered evidence:")),
    );
    expect(sawSynthesisPrompt).toBe(true);
  });

  it("treats leaked tool-call markup as no answer and synthesizes instead", async () => {
    // Round 1 gathers evidence; round 2 "answers" with leaked tool-call markup (the model's
    // function-call dialect wasn't parsed). That must NOT become the report — the synthesis
    // pass runs over the gathered evidence instead.
    const markupAnswer = '<|tool_calls|>\n<|invoke name="search_web"><|parameter name="query">x</|parameter>';
    const synthesisJson = JSON.stringify({
      summary: "Real synthesis.",
      findings: [{ claim: "A", reliability: "medium", sourceEvidenceIds: [] }],
      contradictions: [],
      uncertainties: [],
    });
    const chatModel = new FakeChatModel([
      [{ content: "", isComplete: true, toolCalls: [{ id: "1", name: "search_web", arguments: { query: "a", limit: 3 } }] }],
      [{ content: markupAnswer, isComplete: true }],
      [{ content: synthesisJson, isComplete: true }],
    ]);
    const searchProvider = new FakeSearchProvider([
      { source: webSource("https://e.com/x"), extractedText: "benchmark text", rank: 1, query: "a" },
    ]);

    const agent = new DeepResearchAgent({
      toolsetFactory: createResearchToolRegistry,
      searchProvider,
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
    });

    const result = await agent.run({ question: "What is X?" });

    expect(result.report.summary).toBe("Real synthesis.");
    expect(result.report.summary).not.toContain("invoke");
  });

  it("emits a diagnostic trace to the injected logger", async () => {
    const events: { type: string }[] = [];
    const chatModel = new FakeChatModel([
      [{ content: JSON.stringify({ summary: "s", findings: [], contradictions: [], uncertainties: [] }), isComplete: true }],
    ]);

    const agent = new DeepResearchAgent({
      toolsetFactory: createResearchToolRegistry,
      searchProvider: new FakeSearchProvider([]),
      modelRound: new ChatCompletionsRoundAdapter(chatModel),
      model: "qwen",
      logger: { logDeepResearch: (event) => events.push(event) },
    });

    await agent.run({ question: "What is X?" });

    const types = events.map((event) => event.type);
    expect(types).toContain("session-start");
    expect(types).toContain("loop-complete");
    expect(types).toContain("session-complete");
  });
});

describe("createResearchToolRegistry deep_search gating", () => {
  const runner: DeepResearchRunner = {
    run: async () => ({
      report: {
        question: "q",
        summary: "",
        findings: [],
        contradictions: [],
        uncertainties: [],
      },
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

  it("exposes deep_search when web is active and a runner + provider are present", () => {
    const created = createResearchToolRegistry({
      availability: webAvailability,
      searchProvider: new FakeSearchProvider([]),
      deepResearchRunner: runner,
    });
    expect(created.tools.has("deep_search")).toBe(true);
  });

  it.each(["indexOnly", "none"] as const)(
    "omits deep_search in %s mode (web not active)",
    (searchMode) => {
      const created = createResearchToolRegistry({
        availability: { ...webAvailability, searchMode },
        searchProvider: new FakeSearchProvider([]),
        deepResearchRunner: runner,
      });
      expect(created.tools.has("deep_search")).toBe(false);
    },
  );

  it("omits deep_search without a runner", () => {
    const created = createResearchToolRegistry({
      availability: webAvailability,
      searchProvider: new FakeSearchProvider([]),
    });
    expect(created.tools.has("deep_search")).toBe(false);
  });

  it("omits deep_search without a web provider", () => {
    const created = createResearchToolRegistry({
      availability: { ...webAvailability, webProviderAvailable: false },
      deepResearchRunner: runner,
    });
    expect(created.tools.has("deep_search")).toBe(false);
  });
});
