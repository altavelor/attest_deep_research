// In-process deep-research sub-agent. A self-contained agent loop with its own
// system prompt, web-only toolset, isolated evidence registry and budget. The
// orchestrating (main) model launches one or more of these via the `deep_search`
// tool; each returns structured evidence the main model synthesizes from.

import { ModelRoundProvider } from "@core/agent";
import { ResearchExecutionPolicy } from "@core/research";
import {
  DeepResearchSynthesisSource,
  buildDeepResearchMessages,
  buildDeepResearchSynthesisMessages,
} from "@core/research";
import { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import { SearchProvider } from "@application/ports/web";
import { ResearchToolsetFactory } from "@application/research/toolPorts";
import {
  DEEP_RESEARCH_PHASE,
  DEEP_RESEARCH_TOOL_END,
  DEEP_RESEARCH_TOOL_START,
  DeepResearchLogEvent,
  DeepResearchLogger,
  DeepResearchRunInput,
  DeepResearchRunResult,
  DeepResearchRunner,
} from "@application/research/deepResearchPort";
import { AgenticResearchRunner } from "../AgenticResearchRunner";
import { looksLikeLeakedToolCall, parseDeepResearchReport } from "./parseDeepResearchReport";

export interface DeepResearchAgentDeps {
  toolsetFactory: ResearchToolsetFactory;
  searchProvider: SearchProvider;
  /** Reuses the parent chat model + round provider by default. */
  modelRound: ModelRoundProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { enabled: boolean; effort?: string; summary: "off" | "auto" };
  /** Own budget — smaller than the parent loop so a session stays bounded. */
  maxRounds?: number;
  maxResultChars?: number;
  /** Optional diagnostic sink (gated by debug mode at the composition root). */
  logger?: DeepResearchLogger;
}

const DEFAULT_MAX_ROUNDS = 12;
const DEFAULT_MAX_RESULT_CHARS = 30_000;
const SYNTHESIS_EXCERPT_CHARS = 1_500;

// The sub-agent never forces a tool; the model drives its own loop. parallel
// calls let it fan out sub-queries in one round.
const DEEP_RESEARCH_POLICY: ResearchExecutionPolicy = Object.freeze({
  strategy: "agentic",
  reason: "eligible",
  requiredTools: Object.freeze([] as string[]),
  bootstrapChoice: Object.freeze({ type: "auto" as const }),
  parallelToolCalls: true,
  supportsSpecificChoice: false,
});

export class DeepResearchAgent implements DeepResearchRunner {
  constructor(private readonly deps: DeepResearchAgentDeps) {}

  async run(input: DeepResearchRunInput): Promise<DeepResearchRunResult> {
    const created = this.deps.toolsetFactory({
      availability: {
        searchMode: "webOnly",
        noteAccess: false,
        activeFileAccess: false,
        retrieverAvailable: false,
        webProviderAvailable: true,
        noteMutationAccess: false,
      },
      searchProvider: this.deps.searchProvider,
    });

    const emit = input.onEvent;
    const log = (event: DeepResearchLogEvent): void => this.deps.logger?.logDeepResearch(event);
    const startedAt = Date.now();
    const maxRounds = this.deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const maxResultChars = this.deps.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;

    log({
      type: "session-start",
      question: input.question,
      scope: input.scope,
      model: this.deps.model,
      maxRounds,
      maxResultChars,
      reasoning: this.deps.reasoning
        ? { enabled: this.deps.reasoning.enabled, effort: this.deps.reasoning.effort }
        : undefined,
    });

    emit?.({ type: DEEP_RESEARCH_PHASE, message: "Planning research…" });

    const result = await new AgenticResearchRunner({
      modelRound: this.deps.modelRound,
      model: this.deps.model,
      messages: buildDeepResearchMessages({ question: input.question, scope: input.scope }),
      tools: created.tools,
      policy: DEEP_RESEARCH_POLICY,
      temperature: this.deps.temperature,
      maxTokens: this.deps.maxTokens,
      reasoning: this.deps.reasoning,
      signal: input.signal,
      maxRounds,
      maxResultChars,
      onToolCall: (id, name, label, round) => {
        log({ type: "tool-call", round, name, label });
        emit?.({ type: DEEP_RESEARCH_PHASE, message: phaseForTool(name) });
        emit?.({ type: DEEP_RESEARCH_TOOL_START, data: { id, name, label, round } });
      },
      onToolResult: (id, ok, resolvedLabel, resultSummary) => {
        log({ type: "tool-result", name: resolvedLabel ?? "", ok, summary: resultSummary });
        emit?.({
          type: DEEP_RESEARCH_TOOL_END,
          data: { id, ok, resolvedLabel, resultSummary },
        });
      },
    }).run();

    const rawAnswer = result.ok ? result.answerText : "";
    log({
      type: "loop-complete",
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      rounds: result.rounds,
      totalCalls: result.totalCalls,
      duplicateCalls: result.duplicateCalls,
      totalResultChars: result.totalResultChars,
      stopReasons: result.stopReasons,
      answerChars: rawAnswer.length,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    });

    emit?.({ type: DEEP_RESEARCH_PHASE, message: "Synthesizing evidence…" });

    const snapshot = created.evidence.snapshot();
    let rawText = rawAnswer;
    // Synthesize from evidence when the runner returned no usable answer: either it ended
    // without text (loop-detected, budget, round limit) or the "answer" is leaked tool-call
    // markup the model emitted as text (its function-call dialect wasn't parsed). Either way
    // the gathered evidence would otherwise be dumped as a bare source list with no findings.
    const usedSynthesisFallback = !rawText.trim() || looksLikeLeakedToolCall(rawText);
    if (usedSynthesisFallback) {
      rawText = await this.synthesizeFromEvidence(input, snapshot, log);
    }

    const report = parseDeepResearchReport(input.question, rawText);
    log({
      type: "session-complete",
      findingCount: report.findings.length,
      sourceCount: snapshot.evidence.filter((chunk) => chunk.source.kind === "web").length,
      usedSynthesisFallback,
      durationMs: Date.now() - startedAt,
    });

    return { report, snapshot };
  }

  private async synthesizeFromEvidence(
    input: DeepResearchRunInput,
    snapshot: ResearchEvidenceSnapshot,
    log: (event: DeepResearchLogEvent) => void,
  ): Promise<string> {
    const sources: DeepResearchSynthesisSource[] = [];
    let excerptChars = 0;
    for (const chunk of snapshot.evidence) {
      if (chunk.source.kind !== "web") continue;
      const excerpt = chunk.text.slice(0, SYNTHESIS_EXCERPT_CHARS);
      excerptChars += excerpt.length;
      sources.push({
        evidenceId: chunk.id,
        title: chunk.source.title,
        url: chunk.source.url,
        excerpt,
      });
    }
    log({ type: "synthesis-start", sourceCount: sources.length, excerptChars });
    if (sources.length === 0) {
      log({ type: "synthesis-complete", outputChars: 0 });
      return "";
    }

    try {
      const round = await this.deps.modelRound.runRound({
        model: this.deps.model,
        messages: buildDeepResearchSynthesisMessages({
          question: input.question,
          scope: input.scope,
          sources,
        }),
        tools: [],
        toolChoice: { type: "none" },
        temperature: this.deps.temperature,
        // Same budget as the main loop — a tighter cap would be shared with reasoning
        // tokens and truncate the JSON report, yielding an empty (findingless) result.
        maxTokens: this.deps.maxTokens,
        reasoning: this.deps.reasoning,
        signal: input.signal,
      });

      const text = round.items
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("");
      log({ type: "synthesis-complete", outputChars: text.length });
      return text;
    } catch (error) {
      log({
        type: "synthesis-complete",
        outputChars: 0,
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    }
  }
}

function phaseForTool(name: string): string {
  switch (name) {
    case "search_web":
      return "Searching the web…";
    case "fetch_web_page":
      return "Reading sources…";
    default:
      return "Researching…";
  }
}
