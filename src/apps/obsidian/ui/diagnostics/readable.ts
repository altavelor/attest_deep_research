import { diagnosticReportBodyHtml } from "./html/document";
import { DiagnosticReportV3 } from "./report/types";
import { CSS } from "./html/styles";

export function renderReadableDiagnosticReport(
  container: HTMLElement,
  report: DiagnosticReportV3,
): void {
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  container.classList.toggle("dr-theme-dark", document.body.classList.contains("theme-dark"));
  container.classList.toggle("dr-theme-light", !document.body.classList.contains("theme-dark"));
  const modalOverrides = ".top-nav{display:none}.layout{width:auto;padding:0 4px 24px}";
  shadow.innerHTML = `<style>${CSS}${modalOverrides}</style><div class="dr-root">${diagnosticReportBodyHtml(report)}</div>`;
}
