import {
  ChatMessage,
  ChatModelProvider,
  ChatRequest,
  ChatToolCall,
  ToolCallDiagnostic,
} from "../shared/types";
import { ResearchExecutionPolicy } from "./ResearchExecutionPolicy";
import { ResearchToolRegistry } from "./tools/ResearchToolRegistry";
import { researchToolExecutionPayload, ResearchToolExecution } from "./tools/ResearchTools";

export type AgenticFallbackReason =
  | "multiple-mandatory-tools-unresolved"
  | "mandatory-repair-failed"
  | "model-round-limit-exceeded"
  | "tool-call-limit-exceeded"
  | "tool-result-budget-exceeded"
  | "provider-error"
  | "cancelled"
  | "context-limit-exceeded"
  | "skill-contract-violation";

export interface AgenticResearchRunnerOptions {
  chatModel: ChatModelProvider;
  model: string;
  messages: ChatMessage[];
  tools: ResearchToolRegistry;
  policy: ResearchExecutionPolicy;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  maxRounds?: number;
  maxCallsPerRound?: number;
  maxTotalCalls?: number;
  maxResultChars?: number;
}

export type AgenticResearchResult = AgenticResearchSuccess | AgenticResearchFailure;

export interface AgenticResearchSuccess {
  ok: true;
  answerText: string;
  diagnostics: ToolCallDiagnostic[];
  satisfiedTools: string[];
  repairedTools: string[];
  rounds: number;
  totalCalls: number;
  duplicateCalls: number;
  phases: string[];
  stopReasons: string[];
  totalResultChars: number;
}

export interface AgenticResearchFailure {
  ok: false;
  reason: AgenticFallbackReason;
  diagnostics: ToolCallDiagnostic[];
  satisfiedTools: string[];
  repairedTools: string[];
  rounds: number;
  totalCalls: number;
  duplicateCalls: number;
  phases: string[];
  stopReasons: string[];
  totalResultChars: number;
}

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_MAX_CALLS_PER_ROUND = 5;
const DEFAULT_MAX_TOTAL_CALLS = 10;
const DEFAULT_MAX_RESULT_CHARS = 50_000;
const PREVIEW_CHARS = 600;

interface CachedExecution {
  ok: boolean;
  retryable: boolean;
  result: string;
  diagnostic?: Record<string, unknown>;
}

export class AgenticResearchRunner {
  constructor(private readonly options: AgenticResearchRunnerOptions) {}

  async run(): Promise<AgenticResearchResult> {
    const messages = this.options.messages.map((message) => ({ ...message }));
    const required = new Set(this.options.policy.requiredTools);
    const satisfied = new Set<string>();
    const repaired = new Set<string>();
    const diagnostics: ToolCallDiagnostic[] = [];
    const cache = new Map<string, CachedExecution>();
    const mandatoryFailures = new Map<string, boolean>();
    const maxRounds = this.options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const maxCallsPerRound = this.options.maxCallsPerRound ?? DEFAULT_MAX_CALLS_PER_ROUND;
    const maxTotalCalls = this.options.maxTotalCalls ?? DEFAULT_MAX_TOTAL_CALLS;
    const maxResultChars = this.options.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS;
    let phase: "bootstrap" | "repair" | "research" = "bootstrap";
    let repairTool: string | undefined;
    let totalCalls = 0;
    let duplicateCalls = 0;
    let totalResultChars = 0;
    let rounds = 0;
    const phases: string[] = [];
    const stopReasons: string[] = [];

    const failure = (reason: AgenticFallbackReason): AgenticResearchFailure => ({
      ok: false,
      reason,
      diagnostics,
      satisfiedTools: [...satisfied],
      repairedTools: [...repaired],
      rounds,
      totalCalls,
      duplicateCalls,
      phases,
      stopReasons,
      totalResultChars,
    });

    try {
      for (let round = 1; round <= maxRounds; round += 1) {
        rounds = round;
        phases.push(phase);
        if (this.options.signal?.aborted) return failure("cancelled");
        const toolChoice: ChatRequest["toolChoice"] =
          phase === "bootstrap"
            ? this.options.policy.bootstrapChoice
            : phase === "repair"
              ? { type: "specific", name: repairTool! }
              : { type: "auto" };
        const response = await collectRound(this.options, messages, toolChoice);
        stopReasons.push(response.toolCalls.length > 0 ? "tool_calls" : "complete");

        if (response.toolCalls.length === 0) {
          const missing = missingTools(required, satisfied);
          if (missing.length === 0 && phase !== "repair") {
            return {
              ok: true,
              answerText: response.content,
              diagnostics,
              satisfiedTools: [...satisfied],
              repairedTools: [...repaired],
              rounds,
              totalCalls,
              duplicateCalls,
              phases,
              stopReasons,
              totalResultChars,
            };
          }
          if (phase === "bootstrap" && missing.length === 1) {
            phase = "repair";
            repairTool = missing[0];
            continue;
          }
          return failure(
            missing.length > 1 ? "multiple-mandatory-tools-unresolved" : "mandatory-repair-failed",
          );
        }

        if (
          response.toolCalls.length > maxCallsPerRound ||
          totalCalls + response.toolCalls.length > maxTotalCalls
        ) {
          return failure("tool-call-limit-exceeded");
        }
        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        for (const call of response.toolCalls) {
          totalCalls += 1;
          const key = normalizedCallKey(call);
          let execution = cache.get(key);
          const retryMandatory =
            phase === "repair" &&
            call.name === repairTool &&
            execution?.ok === false &&
            execution.retryable;
          if (execution && !retryMandatory) {
            duplicateCalls += 1;
          } else {
            const raw = await this.options.tools.execute(call);
            execution = serializeExecution(raw);
            cache.set(key, execution);
          }
          if (totalResultChars + execution.result.length > maxResultChars) {
            return failure("tool-result-budget-exceeded");
          }
          totalResultChars += execution.result.length;
          if (execution.ok && required.has(call.name)) satisfied.add(call.name);
          if (!execution.ok && required.has(call.name)) {
            mandatoryFailures.set(call.name, execution.retryable);
          }
          diagnostics.push({
            id: call.id,
            name: call.name,
            status: execution.ok ? "success" : "failed",
            arguments: call.arguments,
            resultPreview: contentBearingTool(call.name)
              ? "[redacted tool content]"
              : execution.result.slice(0, PREVIEW_CHARS),
            resultBytes: execution.result.length,
            round,
            ...(cache.get(key) === execution &&
            diagnostics.some((item) => normalizedDiagnosticKey(item) === key)
              ? { reason: "duplicate-result-reused" }
              : {}),
            ...(execution.diagnostic ? { metadata: execution.diagnostic } : {}),
          });
          messages.push({ role: "tool", content: execution.result, toolCallId: call.id });
        }

        const missing = missingTools(required, satisfied);
        if (phase === "bootstrap") {
          if (missing.length === 0) {
            phase = "research";
          } else if (missing.length === 1) {
            if (mandatoryFailures.get(missing[0]) === false) {
              return failure("mandatory-repair-failed");
            }
            phase = "repair";
            repairTool = missing[0];
          } else {
            return failure("multiple-mandatory-tools-unresolved");
          }
        } else if (phase === "repair") {
          if (missing.length > 0) return failure("mandatory-repair-failed");
          repaired.add(repairTool!);
          phase = "research";
        }
      }
      return failure("model-round-limit-exceeded");
    } catch (error) {
      return failure(
        this.options.signal?.aborted || isAbortError(error) ? "cancelled" : "provider-error",
      );
    }
  }
}

async function collectRound(
  options: AgenticResearchRunnerOptions,
  messages: ChatMessage[],
  toolChoice: ChatRequest["toolChoice"],
): Promise<{ content: string; toolCalls: ChatToolCall[] }> {
  let content = "";
  const toolCalls: ChatToolCall[] = [];
  for await (const chunk of options.chatModel.streamChat({
    model: options.model,
    messages,
    tools: options.tools.definitions(),
    toolChoice,
    parallelToolCalls: options.policy.parallelToolCalls,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    signal: options.signal,
  })) {
    content += chunk.content;
    if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
    if (chunk.isComplete) break;
  }
  return { content, toolCalls };
}

function serializeExecution(execution: ResearchToolExecution<unknown>): CachedExecution {
  return {
    ok: execution.ok,
    retryable: execution.ok ? false : execution.error.retryable,
    result: JSON.stringify(researchToolExecutionPayload(execution)),
    ...(execution.diagnostic ? { diagnostic: execution.diagnostic } : {}),
  };
}

function missingTools(required: Set<string>, satisfied: Set<string>): string[] {
  return [...required].filter((name) => !satisfied.has(name));
}

function normalizedCallKey(call: Pick<ChatToolCall, "name" | "arguments">): string {
  return `${call.name}:${stableJson(call.arguments)}`;
}

function normalizedDiagnosticKey(diagnostic: ToolCallDiagnostic): string {
  return `${diagnostic.name}:${stableJson(diagnostic.arguments)}`;
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function contentBearingTool(name: string): boolean {
  return name === "read_note" || name === "get_active_note" || name === "fetch_web_page";
}
