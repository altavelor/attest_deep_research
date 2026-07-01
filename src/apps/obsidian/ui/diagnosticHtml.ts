import { ContextDiagnostics } from "@core/diagnostics";
import { buildDiagnosticReportV3 } from "./diagnosticReportV3";
import { DiagnosticReportV3 } from "./diagnostics/report/types";
import { h } from "./diagnostics/html/primitives";
import {
  renderAnswer,
  renderFindings,
  renderHeader,
  renderModel,
  renderNav,
  renderPreflight,
  renderReasoning,
  renderRequest,
  renderTimeline,
  renderWarnings,
} from "./diagnostics/html/sections";
import { CSS } from "./diagnostics/html/styles";

export function formatDiagnosticReportHtml(diagnostics: ContextDiagnostics): string {
  const report = buildDiagnosticReportV3(diagnostics);
  return renderHtml(report);
}

function renderHtml(report: DiagnosticReportV3): string {
  const title = `Diagnostic report · ${h(report.stats.runId || "unknown")}`;
  const body = [
    renderNav(report),
    `<main class="layout">`,
    renderHeader(report),
    renderFindings(report.findings),
    renderModel(report),
    renderPreflight(report),
    renderRequest(report),
    renderReasoning(report),
    renderAnswer(report),
    renderTimeline(report),
    renderWarnings(report),
    `</main>`,
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>${body}</body>
</html>`;
}
