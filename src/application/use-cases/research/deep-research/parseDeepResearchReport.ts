// Tolerant parser turning a deep-research sub-agent's final text into a
// DeepResearchReport. The sub-agent is asked to end with a fenced JSON block; if
// that is missing or malformed we degrade gracefully to a summary-only report so
// a session never hard-fails the parent run.

import { parseLlmJsonObject } from "../../../../shared/llmOutput";
import {
  DeepResearchFinding,
  DeepResearchReport,
  isDeepResearchReliability,
} from "../../../../core/research/deepResearch/deepResearchReport";

const MAX_REPORT_INPUT_CHARS = 40_000;

// Tool-call markup some models emit as plain text when their function-call dialect is not
// parsed into structured calls (harmony `<|tool_calls|>`/`<|invoke>`, Anthropic-style
// `<invoke name=…>`, Hermes `<tool_call>`). Such text is never a real report — letting it
// become the summary dumps raw markup at the parent.
const LEAKED_TOOL_CALL_MARKUP =
  /<\|?\s*(?:tool_calls?|function_calls?|(?:antml:)?invoke|tool_call)\b|\binvoke\s+name\s*=/i;

export function looksLikeLeakedToolCall(text: string): boolean {
  return LEAKED_TOOL_CALL_MARKUP.test(text.slice(0, 4_000));
}

export function parseDeepResearchReport(question: string, rawText: string): DeepResearchReport {
  const parsed = parseLlmJsonObject<Record<string, unknown>>(rawText, {
    fallback: {},
    maxInputLength: MAX_REPORT_INPUT_CHARS,
    validate: isRecord,
  });

  const fallbackSummary = looksLikeLeakedToolCall(rawText) ? "" : rawText.trim();
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : fallbackSummary;

  return {
    question,
    summary,
    findings: parseFindings(parsed.findings),
    contradictions: parseStringArray(parsed.contradictions),
    uncertainties: parseStringArray(parsed.uncertainties),
  };
}

function parseFindings(value: unknown): DeepResearchFinding[] {
  if (!Array.isArray(value)) return [];
  const findings: DeepResearchFinding[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const claim = typeof entry.claim === "string" ? entry.claim.trim() : "";
    if (!claim) continue;
    findings.push({
      claim,
      reliability: isDeepResearchReliability(entry.reliability) ? entry.reliability : "low",
      sourceEvidenceIds: parseStringArray(entry.sourceEvidenceIds),
    });
  }
  return findings;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
