import type { ModelRoundProvider, ModelRoundResult } from "@core/agent";
import type {
  SubAgentExecutionPort,
  SubAgentExecutionRequest,
  SubAgentExecutionResult,
} from "@application/ports/subAgent";
import type {
  SubAgentPort,
  SubAgentToolCall,
  SubAgentToolResult,
} from "@application/research/subAgentPort";
import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import {
  mergeSubAgentUsage,
  toValidatedJson,
  type NormalizedUsage,
  type SubAgentModelSnapshot,
  type SubAgentWorkflowItem,
  type ValidatedJsonValue,
} from "@core/research";

export interface SubAgentModelSelection {
  model: SubAgentModelSnapshot;
  modelRound: ModelRoundProvider;
}

export interface SubAgentExecutionAdapterDeps {
  selectModel(): SubAgentModelSelection;
  createRunner(modelRound: ModelRoundProvider): SubAgentPort;
  now(): Date;
}

/**
 * Runs one child command with a runner bound to the model selected when the run starts.
 * It reports the model and the first assembled request before that request is sent,
 * usage per request, and tool calls with their payloads through the request's
 * observation callback; the manager redacts and bounds everything it stores.
 */
export class SubAgentExecutionAdapter implements SubAgentExecutionPort {
  constructor(private readonly deps: SubAgentExecutionAdapterDeps) {}

  async run(request: SubAgentExecutionRequest): Promise<SubAgentExecutionResult> {
    const { model, modelRound } = this.deps.selectModel();
    const usages: NormalizedUsage[] = [];
    const observed = this.observedModelRound(request, model, modelRound, usages);
    const tools = new Map<string, SubAgentWorkflowItem>();
    const output = await this.deps.createRunner(observed).run({
      task: taskWithContext(request),
      budget: request.limits,
      resources: request.resources,
      signal: request.signal,
      onEvent: (event) => {
        if (event.type !== "sub-agent-phase" || typeof event.message !== "string") return;
        const occurredAt = this.deps.now().toISOString();
        request.onObservation({
          type: "phase",
          runId: request.runId,
          phase: event.message,
          occurredAt,
        });
      },
      onToolCall: (call) => this.toolStarted(request, tools, call),
      onToolResult: (result) => this.toolEnded(request, tools, result),
    });
    const telemetry = output.telemetry;
    const failureReason = telemetry?.failureReason ?? null;
    return {
      answerText: output.answerText,
      evidence: childEvidence(output.snapshot),
      usage: { ...mergeSubAgentUsage(usages).usage, toolCalls: telemetry?.toolCalls ?? 0 },
      incomplete: request.signal.aborted || failureReason !== null,
      terminalReason: failureReason,
      telemetry: toValidatedJson(telemetry ?? null) ?? null,
    };
  }

  private observedModelRound(
    request: SubAgentExecutionRequest,
    model: SubAgentModelSnapshot,
    modelRound: ModelRoundProvider,
    usages: NormalizedUsage[],
  ): ModelRoundProvider {
    let requests = 0;
    return {
      listModels: () => modelRound.listModels(),
      runRound: async (round) => {
        requests += 1;
        const requestId = `${request.runId}:request-${requests}`;
        if (requests === 1) {
          request.onObservation({
            type: "model-started",
            runId: request.runId,
            model,
            prompt: {
              runId: request.runId,
              capturedAt: this.deps.now().toISOString(),
              state: "captured",
              messages: round.messages.map((message) => ({
                role: message.role,
                content: typeof message.content === "string" ? message.content : "",
              })),
              redacted: false,
              truncated: false,
            },
          });
        }
        const result = await modelRound.runRound(round);
        const usage = requestUsage(result);
        usages.push(usage);
        request.onObservation({
          type: "usage",
          runId: request.runId,
          requestId,
          usage,
          final: true,
        });
        return result;
      },
    };
  }

  private toolStarted(
    request: SubAgentExecutionRequest,
    tools: Map<string, SubAgentWorkflowItem>,
    call: SubAgentToolCall,
  ): void {
    const item: SubAgentWorkflowItem = {
      id: `${request.runId}:${call.id}`,
      sessionId: request.sessionId,
      runId: request.runId,
      name: call.name,
      label: call.label,
      sequence: 0,
      round: call.round,
      status: "pending",
      startedAt: this.deps.now().toISOString(),
      ...(call.args ? { args: call.args } : {}),
      payloadState: "captured",
    };
    tools.set(call.id, item);
    request.onObservation({ type: "tool-start", item });
  }

  private toolEnded(
    request: SubAgentExecutionRequest,
    tools: Map<string, SubAgentWorkflowItem>,
    result: SubAgentToolResult,
  ): void {
    const started = tools.get(result.id);
    if (!started) return;
    tools.delete(result.id);
    request.onObservation({
      type: "tool-end",
      item: {
        ...started,
        status: result.ok ? "complete" : "failed",
        completedAt: this.deps.now().toISOString(),
        ...(result.resolvedLabel ? { label: result.resolvedLabel } : {}),
        ...(result.resultSummary !== undefined ? { resultSummary: result.resultSummary } : {}),
        ...(result.resultJson !== undefined ? { resultJson: result.resultJson } : {}),
      },
    });
  }
}

function requestUsage(result: ModelRoundResult): NormalizedUsage {
  const base = { requestCount: 1, modelRounds: 1, toolCalls: 0, durationMs: 0 };
  if (!result.usage) return { ...base, source: "unavailable" };
  return {
    ...base,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    source: "provider",
  };
}

function taskWithContext(request: SubAgentExecutionRequest): string {
  const { summary, previousResult, partialSummary } = request.priorContext;
  const sections = [
    request.task,
    ...(summary ? [`Session summary:\n${summary}`] : []),
    ...(previousResult ? [`Previous result:\n${previousResult}`] : []),
    ...(partialSummary ? [`Partial result to continue:\n${partialSummary}`] : []),
  ];
  return sections.join("\n\n");
}

function childEvidence(snapshot: ResearchEvidenceSnapshot): ValidatedJsonValue[] {
  return snapshot.evidence.flatMap((chunk) => {
    const call = snapshot.provenance.find((entry) => entry.evidenceId === chunk.id)?.calls[0];
    if (!call) return [];
    const value = toValidatedJson({
      id: chunk.id,
      source: chunk.source,
      text: chunk.text,
      tool: call.tool,
      ...(call.query !== undefined ? { query: call.query } : {}),
    });
    return value === undefined ? [] : [value];
  });
}
