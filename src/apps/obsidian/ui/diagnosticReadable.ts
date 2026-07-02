// Readable view of the diagnostic modal: the exact same report body as the
// downloadable HTML export, hosted in a shadow root so its stylesheet and the
// app's styles cannot leak into each other.

import { diagnosticReportBodyHtml } from "./diagnosticHtml";
import { DiagnosticReportV3 } from "./diagnostics/report/types";
import { CSS } from "./diagnostics/html/styles";

export function renderReadableDiagnosticReport(
  container: HTMLElement,
  report: DiagnosticReportV3,
): void {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  // Follow Obsidian's active theme instead of the OS colour scheme.
  container.classList.toggle("dr-theme-dark", document.body.classList.contains("theme-dark"));
  container.classList.toggle("dr-theme-light", !document.body.classList.contains("theme-dark"));
  // Sticky in-page nav is redundant inside the modal (it has its own chrome).
  const modalOverrides = ".top-nav{display:none}.layout{width:auto;padding:0 4px 24px}";
  shadow.innerHTML = `<style>${CSS}${modalOverrides}</style><div class="dr-root">${diagnosticReportBodyHtml(report)}</div>`;
}
