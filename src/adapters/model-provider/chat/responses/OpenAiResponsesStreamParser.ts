import { IxplorerError } from "@core/errors";
import { ModelOutputItem, ModelRoundResult } from "@core/agent";

export interface ParsedResponsesRound {
  result: ModelRoundResult;
  providerOutput: Record<string, unknown>[];
}

export function parseResponsesTerminalEvent(value: unknown): ParsedResponsesRound | undefined {
  const event = asRecord(value);
  if (!event || typeof event.type !== "string") return undefined;
  if (event.type === "error") throw protocolError("responses-provider-error");
  if (
    event.type !== "response.completed" &&
    event.type !== "response.incomplete" &&
    event.type !== "response.failed"
  ) {
    return undefined;
  }
  const response = asRecord(event.response);
  if (!response) throw protocolError("responses-terminal-missing-response");
  const output = Array.isArray(response.output)
    ? response.output.map((item) => requireRecord(item, "responses-invalid-output-item"))
    : [];
  const status = response.status;
  if (event.type === "response.incomplete" || status === "incomplete") {
    return {
      result: { items: [], stopReason: "length", usage: parseUsage(response.usage) },
      providerOutput: [],
    };
  }
  if (event.type === "response.failed" || status === "failed") {
    throw protocolError("responses-failed");
  }
  if (status !== "completed") throw protocolError("responses-unknown-terminal-status");
  const items: ModelOutputItem[] = [];
  for (const item of output) {
    if (typeof item.id !== "string" || !item.id) {
      throw protocolError("responses-output-item-missing-id");
    }
    const type = item.type;
    if (type === "message") {
      if (!Array.isArray(item.content)) throw protocolError("responses-invalid-message-content");
      for (const content of item.content) {
        const part = requireRecord(content, "responses-invalid-content-part");
        if (part.type === "output_text" && typeof part.text === "string" && part.text) {
          items.push({ type: "text", text: part.text });
        }
      }
    } else if (type === "reasoning") {
      if (Array.isArray(item.summary)) {
        for (const summary of item.summary) {
          if (typeof summary === "string" && summary) {
            items.push({ type: "reasoningSummary", text: summary });
            continue;
          }
          const part = asRecord(summary);
          if (part?.type === "summary_text" && typeof part.text === "string" && part.text) {
            items.push({ type: "reasoningSummary", text: part.text });
          }
        }
      }
      if (Array.isArray(item.content)) {
        for (const content of item.content) {
          const part = asRecord(content);
          if (part?.type === "reasoning_text" && typeof part.text === "string" && part.text) {
            items.push({ type: "reasoningSummary", text: part.text });
          }
        }
      }
    } else if (type === "function_call") {
      if (
        typeof item.call_id !== "string" ||
        !item.call_id ||
        typeof item.name !== "string" ||
        !item.name ||
        typeof item.arguments !== "string"
      )
        throw protocolError("responses-invalid-function-call");
      let args: unknown;
      try {
        args = JSON.parse(item.arguments);
      } catch {
        throw protocolError("responses-invalid-function-arguments");
      }
      const argumentsRecord = asRecord(args);
      if (!argumentsRecord) throw protocolError("responses-invalid-function-arguments");
      items.push({
        type: "toolCall",
        call: { id: item.call_id, name: item.name, arguments: argumentsRecord },
      });
    }
  }
  return {
    result: {
      items,
      stopReason: items.some((item) => item.type === "toolCall") ? "tool_calls" : "complete",
      usage: parseUsage(response.usage),
      reasoningItemCount: output.filter((item) => item.type === "reasoning").length,
    },
    providerOutput: output,
  };
}

function parseUsage(value: unknown): ModelRoundResult["usage"] {
  const usage = asRecord(value);
  const details = asRecord(usage?.output_tokens_details);
  if (!usage) return undefined;
  return {
    inputTokens: numberOrZero(usage.input_tokens),
    outputTokens: numberOrZero(usage.output_tokens),
    reasoningTokens: numberOrZero(details?.reasoning_tokens),
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireRecord(value: unknown, reason: string): Record<string, unknown> {
  const record = asRecord(value);
  if (!record) throw protocolError(reason);
  return record;
}

export function protocolError(reason: string): IxplorerError {
  return new IxplorerError({
    code: "MODEL_PROVIDER_UNAVAILABLE",
    message: "The Responses provider returned an invalid stream.",
    details: { reason },
  });
}
