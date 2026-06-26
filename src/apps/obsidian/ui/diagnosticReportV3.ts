import { ContextDiagnostics } from "../../../core/diagnostics";
import {
  buildAnswerSection,
  buildModelSection,
  buildPreflightSection,
  buildReasoningSection,
  buildRequestSection,
  buildStatsSection,
} from "./diagnostics/report/sections";
import { computeFindings } from "./diagnostics/report/findings";
import { DiagnosticReportV3 } from "./diagnostics/report/types";

export * from "./diagnostics/report/types";

export function buildDiagnosticReportV3(diagnostics: ContextDiagnostics): DiagnosticReportV3 {
  const model = buildModelSection(diagnostics);
  const preflight = buildPreflightSection(diagnostics);
  const request = buildRequestSection(diagnostics);
  const reasoning = buildReasoningSection(diagnostics);
  const answer = buildAnswerSection(diagnostics);
  const stats = buildStatsSection(diagnostics);
  const findings = computeFindings({ model, preflight, request, reasoning, answer });

  return {
    schemaVersion: 3,
    question: diagnostics.question ?? "",
    findings,
    model,
    preflight,
    request,
    reasoning,
    answer,
    stats,
  };
}
