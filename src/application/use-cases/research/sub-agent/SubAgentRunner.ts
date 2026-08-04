import { ChatMessage, ModelRoundProvider } from "@core/agent";
import { ResearchExecutionPolicy } from "@core/research";
import { buildThinkingResearchMessages } from "@core/research";
import { sourceLabel } from "@core/retrieval";
import { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import { SearchProvider } from "@application/ports/web";
import { ResearchToolsetFactory, ResearchToolsetOptions } from "@application/research/toolPorts";
import {
  SUB_AGENT_PHASE,
  SUB_AGENT_TOOL_END,
  SUB_AGENT_TOOL_START,
  SubAgentLogEvent,
  SubAgentLogger,
  SubAgentPort,
  SubAgentRunInput,
  SubAgentRunResult,
} from "@application/research/subAgentPort";
import { ThinkingResearchRunner } from "../ThinkingResearchRunner";
import { looksLikeLeakedToolCall } from "./leakedToolCallMarkup";

export interface SubAgentRunnerDeps {
  toolsetFactory: ResearchToolsetFactory;

  searchProvider?: SearchProvider;

  modelRound: ModelRoundProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: { enabled: boolean; effort?: string; summary: "off" | "auto" };

  maxRounds?: number;
  maxResultChars?: number;

  logger?: SubAgentLogger;
}

const DEFAULT_MAX_ROUNDS = 12;
const DEFAULT_MAX_RESULT_CHARS = 30_000;
const SYNTHESIS_EXCERPT_CHARS = 1_500;

const SUB_AGENT_POLICY: ResearchExecutionPolicy = Object.freeze({
  strategy: "thinking",
  reason: "thinking-eligible",
  requiredTools: Object.freeze([] as string[]),
  bootstrapChoice: Object.freeze({ type: "auto" as const }),
  parallelToolCalls: true,
  supportsSpecificChoice: false,
});

const SUB_AGENT_FRAMING =
  "You are an autonomous sub-agent delegated a specific task by an orchestrating agent — " +
  "there is no further user turn to come back to. Work the task end to end using the tools " +
  "above, then produce one complete final answer (no tool calls) using the citation format " +
  "already described. If something could not be established, say so explicitly.";

export class SubAgentRunner implements SubAgentPort {
  constructor(private readonly deps: SubAgentRunnerDeps) {}

  async run(input: SubAgentRunInput): Promise<SubAgentRunResult> {
    const toolsetOptions: ResearchToolsetOptions = input.toolContext ?? {
      availability: {
        searchMode: "webOnly",
        noteAccess: false,
        activeFileAccess: false,
        retrieverAvailable: false,
        webProviderAvailable: this.deps.searchProvider !== undefined,
        noteMutationAccess: false,
      },
      searchProvider: this.deps.searchProvider,
    };
    const created = this.deps.toolsetFactory(toolsetOptions);

    const emit = input.onEvent;
    const log = (event: SubAgentLogEvent): void => this.deps.logger?.logSubAgent(event);
    const startedAt = Date.now();
    const maxRounds = input.budget?.maxRounds ?? this.deps.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const maxResultChars =
      input.budget?.maxResultChars ?? this.deps.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;

    log({
      type: "session-start",
      task: input.task,
      model: this.deps.model,
      maxRounds,
      maxResultChars,
      reasoning: this.deps.reasoning
        ? { enabled: this.deps.reasoning.enabled, effort: this.deps.reasoning.effort }
        : undefined,
    });

    emit?.({ type: SUB_AGENT_PHASE, message: "Planning…" });

    const messages: ChatMessage[] = buildThinkingResearchMessages({
      question: input.task,
      requiredTools: [],
      toolContext: {
        coreVariant: "research",
        availableTools: created.tools.definitions().map((definition) => definition.function.name),
      },
    });
    messages.splice(1, 0, { role: "system", content: SUB_AGENT_FRAMING });

    const result = await new ThinkingResearchRunner({
      modelRound: this.deps.modelRound,
      model: this.deps.model,
      messages,
      tools: created.tools,
      policy: SUB_AGENT_POLICY,
      temperature: this.deps.temperature,
      maxTokens: this.deps.maxTokens,
      reasoning: this.deps.reasoning,
      signal: input.signal,
      maxRounds,
      maxResultChars,
      onToolCall: (id, name, label, round) => {
        log({ type: "tool-call", round, name, label });
        emit?.({ type: SUB_AGENT_PHASE, message: phaseForTool(name) });
        emit?.({ type: SUB_AGENT_TOOL_START, data: { id, name, label, round } });
      },
      onToolResult: (id, ok, resolvedLabel, resultSummary) => {
        log({ type: "tool-result", name: resolvedLabel ?? "", ok, summary: resultSummary });
        emit?.({
          type: SUB_AGENT_TOOL_END,
          data: { id, ok, resolvedLabel, resultSummary },
        });
      },
    }).run();

    let answerText = result.ok ? result.answerText : "";
    log({
      type: "loop-complete",
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      rounds: result.rounds,
      totalCalls: result.totalCalls,
      duplicateCalls: result.duplicateCalls,
      totalResultChars: result.totalResultChars,
      stopReasons: result.stopReasons,
      answerChars: answerText.length,
      usage: result.usage,
      durationMs: Date.now() - startedAt,
    });

    const snapshot = created.evidence.snapshot();
    const usedSynthesisFallback =
      !input.signal?.aborted && (!answerText.trim() || looksLikeLeakedToolCall(answerText));
    if (usedSynthesisFallback) {
      emit?.({ type: SUB_AGENT_PHASE, message: "Synthesizing evidence…" });
      answerText = await this.synthesizeFromEvidence(input, snapshot, log);
    }

    log({
      type: "session-complete",
      sourceCount: snapshot.evidence.length,
      usedSynthesisFallback,
      durationMs: Date.now() - startedAt,
    });

    return { answerText, snapshot };
  }

  private async synthesizeFromEvidence(
    input: SubAgentRunInput,
    snapshot: ResearchEvidenceSnapshot,
    log: (event: SubAgentLogEvent) => void,
  ): Promise<string> {
    const excerpts: string[] = [];
    let excerptChars = 0;
    for (const chunk of snapshot.evidence) {
      const label =
        chunk.source.kind === "web"
          ? `${chunk.source.title || chunk.source.url} — ${chunk.source.url}`
          : sourceLabel(chunk.source);
      const excerpt = chunk.text.slice(0, SYNTHESIS_EXCERPT_CHARS);
      excerptChars += excerpt.length;
      excerpts.push(`[${chunk.id}] ${label}\n${excerpt}`);
    }
    log({ type: "synthesis-start", sourceCount: excerpts.length, excerptChars });
    if (excerpts.length === 0) {
      log({ type: "synthesis-complete", outputChars: 0 });
      return "";
    }

    try {
      const round = await this.deps.modelRound.runRound({
        model: this.deps.model,
        messages: [
          {
            role: "system",
            content:
              "The sub-agent's tool loop ended (out of budget or rounds) before writing a final " +
              "answer. Do NOT call any tool. Using only the evidence below, write the best possible " +
              "final answer to the task, citing sources with the same [url:...] / [evidenceId] format " +
              "already used in the tool results. Partial findings are far more useful than none.",
          },
          {
            role: "user",
            content: `Task: ${input.task}\n\nGathered evidence:\n${excerpts.join("\n\n")}`,
          },
        ],
        tools: [],
        toolChoice: { type: "none" },
        temperature: this.deps.temperature,
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
    case "search_index":
      return "Searching the index…";
    case "read_note":
    case "get_active_note":
      return "Reading notes…";
    default:
      return "Working…";
  }
}
