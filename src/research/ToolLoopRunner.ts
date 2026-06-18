import {
  ChatMessage,
  ChatModelProvider,
  ChatRequest,
  ChatToolCall,
  ChatToolDefinition,
  ToolCallDiagnostic,
} from "../shared/types";

export interface ToolLoopRunnerOptions {
  chatModel: ChatModelProvider;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  executeTool(
    toolCall: ChatToolCall,
  ): Promise<{ ok: boolean; result: string; diagnostic?: Record<string, unknown> }>;
  temperature?: number;
  maxTokens?: number;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
  maxTotalResultChars?: number;
}

export interface ToolLoopEvent {
  type: "delta" | "complete";
  content: string;
}

export interface ToolLoopResult {
  events: ToolLoopEvent[];
  answerText: string;
  diagnostics: ToolCallDiagnostic[];
}

const DEFAULT_MAX_ROUNDS = 5;
const DEFAULT_MAX_TOOL_CALLS_PER_ROUND = 5;
const DEFAULT_MAX_TOTAL_RESULT_CHARS = 50_000;
const RESULT_PREVIEW_CHARS = 600;

export async function runToolLoop(options: ToolLoopRunnerOptions): Promise<ToolLoopResult> {
  const messages = [...options.messages];
  const events: ToolLoopEvent[] = [];
  const diagnostics: ToolCallDiagnostic[] = [];
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCallsPerRound = options.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS_PER_ROUND;
  const maxTotalResultChars = options.maxTotalResultChars ?? DEFAULT_MAX_TOTAL_RESULT_CHARS;
  let totalResultChars = 0;
  let answerText = "";

  for (let round = 1; round <= maxRounds; round += 1) {
    const roundResult = await collectModelRound({
      chatModel: options.chatModel,
      model: options.model,
      messages,
      tools: options.tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });

    answerText = roundResult.content;

    if (roundResult.toolCalls.length === 0) {
      events.push(...roundResult.events, { type: "complete", content: "" });
      return { events, answerText, diagnostics };
    }

    messages.push({
      role: "assistant",
      content: roundResult.content,
      toolCalls: roundResult.toolCalls,
    });

    for (const toolCall of roundResult.toolCalls.slice(0, maxToolCallsPerRound)) {
      const remainingChars = maxTotalResultChars - totalResultChars;
      if (remainingChars <= 0) {
        const result = JSON.stringify({ ok: false, reason: "tool-output-budget-exceeded" });
        diagnostics.push({
          id: toolCall.id,
          name: toolCall.name,
          status: "skipped",
          arguments: toolCall.arguments,
          round,
          reason: "tool-output-budget-exceeded",
        });
        messages.push({
          role: "tool",
          content: result,
          toolCallId: toolCall.id,
        });
        continue;
      }

      const execution = await options.executeTool(toolCall);
      const result = truncateResult(execution.result, remainingChars);
      totalResultChars += result.length;
      diagnostics.push({
        id: toolCall.id,
        name: toolCall.name,
        status: execution.ok ? "success" : "failed",
        arguments: toolCall.arguments,
        resultPreview: result.slice(0, RESULT_PREVIEW_CHARS),
        resultBytes: result.length,
        round,
        reason: result.length < execution.result.length ? "tool-output-truncated" : undefined,
        metadata: execution.diagnostic,
      });
      messages.push({
        role: "tool",
        content: result,
        toolCallId: toolCall.id,
      });
    }

    if (roundResult.toolCalls.length > maxToolCallsPerRound) {
      for (const toolCall of roundResult.toolCalls.slice(maxToolCallsPerRound)) {
        const result = JSON.stringify({ ok: false, reason: "tool-call-limit-exceeded" });
        diagnostics.push({
          id: toolCall.id,
          name: toolCall.name,
          status: "skipped",
          arguments: toolCall.arguments,
          round,
          reason: "tool-call-limit-exceeded",
        });
        messages.push({
          role: "tool",
          content: result,
          toolCallId: toolCall.id,
        });
      }
    }
  }

  return { events: [{ type: "complete", content: "" }], answerText, diagnostics };
}

async function collectModelRound(options: {
  chatModel: ChatModelProvider;
  model: string;
  messages: ChatMessage[];
  tools: ChatToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}): Promise<{ content: string; events: ToolLoopEvent[]; toolCalls: ChatToolCall[] }> {
  const events: ToolLoopEvent[] = [];
  const toolCalls: ChatToolCall[] = [];
  let content = "";

  for await (const chunk of options.chatModel.streamChat({
    model: options.model,
    messages: options.messages,
    tools: options.tools,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  } satisfies ChatRequest)) {
    if (chunk.content) {
      content += chunk.content;
      events.push({ type: "delta", content: chunk.content });
    }

    if (chunk.toolCalls) {
      toolCalls.push(...chunk.toolCalls);
    }

    if (chunk.isComplete) {
      break;
    }
  }

  return { content, events, toolCalls };
}

function truncateResult(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return JSON.stringify({
    ok: false,
    reason: "tool-output-truncated",
    content: value.slice(0, Math.max(0, maxChars - 100)),
  });
}
