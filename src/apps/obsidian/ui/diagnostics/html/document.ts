import { ContextDiagnostics } from "@core/diagnostics";
import { buildDiagnosticReportV3 } from "../report/build";
import { DiagnosticReportV3 } from "../report/types";
import { h } from "./primitives";
import { renderFindings, renderHeader, renderInput, renderInternals, renderNav } from "./sections";
import { renderRunTrace } from "./trace";
import { CSS } from "./styles";

export function formatDiagnosticReportHtml(diagnostics: ContextDiagnostics): string {
  return renderDiagnosticHtmlDocument(buildDiagnosticReportV3(diagnostics));
}

/**
 * The report body shared verbatim by the standalone HTML export and the modal's
 * readable view (which injects it into a shadow root) — one report, two hosts.
 */
export function diagnosticReportBodyHtml(report: DiagnosticReportV3): string {
  return [
    renderNav(report),
    `<main class="layout">`,
    renderHeader(report),
    renderFindings(report.findings),
    renderRunTrace(report),
    renderInput(report),
    renderInternals(report),
    `</main>`,
  ].join("\n");
}

export function renderDiagnosticHtmlDocument(report: DiagnosticReportV3): string {
  const title = `Diagnostic report · ${h(report.stats.runId || "unknown")}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>${diagnosticReportBodyHtml(report)}</body>
</html>`;
}
