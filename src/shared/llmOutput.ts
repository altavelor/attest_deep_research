export type LlmJsonParseFailureReason =
  | "empty-output"
  | "json-not-found"
  | "invalid-json"
  | "invalid-shape"
  | "output-too-large";

export interface LlmJsonParseDiagnostic {
  ok: boolean;
  reason?: LlmJsonParseFailureReason;
  inputLength: number;
}

export interface ParseLlmJsonObjectOptions<T> {
  fallback: T;
  validate: (value: unknown) => value is T;
  maxInputLength?: number;
  onDiagnostic?: (diagnostic: LlmJsonParseDiagnostic) => void;
}

export async function collectChatText(
  chunks: AsyncIterable<{ content: string; isComplete: boolean }>,
  options: { maxLength?: number } = {},
): Promise<string> {
  const maxLength = options.maxLength ?? Number.POSITIVE_INFINITY;
  let text = "";

  for await (const chunk of chunks) {
    text += chunk.content;

    if (text.length >= maxLength) {
      text = text.slice(0, maxLength);
      break;
    }

    if (chunk.isComplete) {
      break;
    }
  }

  return text;
}

export function parseLlmJsonObject<T>(value: string, options: ParseLlmJsonObjectOptions<T>): T {
  const inputLength = value.length;

  if (options.maxInputLength !== undefined && inputLength > options.maxInputLength) {
    options.onDiagnostic?.({ ok: false, reason: "output-too-large", inputLength });
    return options.fallback;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    options.onDiagnostic?.({ ok: false, reason: "empty-output", inputLength });
    return options.fallback;
  }

  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    options.onDiagnostic?.({ ok: false, reason: "json-not-found", inputLength });
    return options.fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } catch {
    options.onDiagnostic?.({ ok: false, reason: "invalid-json", inputLength });
    return options.fallback;
  }

  if (!options.validate(parsed)) {
    options.onDiagnostic?.({ ok: false, reason: "invalid-shape", inputLength });
    return options.fallback;
  }

  options.onDiagnostic?.({ ok: true, inputLength });
  return parsed;
}
