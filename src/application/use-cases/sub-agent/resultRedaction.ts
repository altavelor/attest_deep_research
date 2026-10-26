import type { SubAgentExecutionResult } from "@application/ports/subAgent";
import { redactSubAgentJson, type SubAgentRedactor } from "@core/research";

/**
 * Returns the child result with its answer and every evidence string except item ids
 * redacted. The import is planned, digested, staged and summarised only from this form,
 * so a replay of the same raw result gives the same import id.
 */
export function redactExecutionResult(
  result: SubAgentExecutionResult,
  redact: SubAgentRedactor,
): SubAgentExecutionResult {
  return {
    ...result,
    answerText: redact(result.answerText),
    evidence: result.evidence.map((value) => redactSubAgentJson(value, redact)),
  };
}
