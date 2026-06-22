import { DiagnosticReportViewModel } from "./diagnosticFormatting";

export function formatDiagnosticReportHtml(view: DiagnosticReportViewModel): string {
  const metrics = view.metrics
    .map(
      (metric) =>
        `<div class="metric"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`,
    )
    .join("");
  const findings = view.findings.length
    ? `<section><h2>Findings</h2>${view.findings.map((finding) => `<article class="finding ${escapeAttribute(finding.severity)}"><strong>${escapeHtml(finding.code)}</strong><p>${escapeHtml(finding.message)}</p><small>${escapeHtml(finding.likelyLayer)}</small></article>`).join("")}</section>`
    : "";
  const timeline = view.timeline.length
    ? `<section id="timeline"><h2>Timeline</h2><ol>${view.timeline.map((item) => `<li><time>+${item.offsetMs} ms</time><strong>${escapeHtml(item.type)}</strong>${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}</li>`).join("")}</ol></section>`
    : "";
  const sections = view.sections
    .map(
      (section) =>
        `<section id="${escapeAttribute(section.id)}"><h2>${escapeHtml(section.title)}</h2><dl>${section.rows.map((row) => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join("")}</dl></section>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(view.title)}</title><style>
:root{color-scheme:light dark;--bg:#f4f5f7;--surface:#fff;--text:#20242c;--muted:#626a76;--border:#dfe3e8;--accent:#176b55;--danger:#a13c3c} @media(prefers-color-scheme:dark){:root{--bg:#16191e;--surface:#20242b;--text:#eef1f4;--muted:#aab2bf;--border:#39404b;--accent:#78cbb2;--danger:#f19a9f}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}.layout{width:min(1100px,calc(100% - 32px));margin:auto;padding:32px 0}header,section{margin-bottom:16px;padding:20px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}h1,h2,p{margin-top:0}.muted,dt,small,time{color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px}.metric{padding:14px;border:1px solid var(--border);border-radius:8px;background:var(--surface)}.metric span,.metric strong{display:block}dl div{display:grid;grid-template-columns:minmax(150px,1fr) 2fr;gap:12px;padding:7px 0;border-bottom:1px solid var(--border)}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}ol{padding-left:22px}li{display:grid;grid-template-columns:90px minmax(160px,1fr) 2fr;gap:10px;padding:6px}.finding.error{border-left:4px solid var(--danger);padding-left:12px}@media print{body{background:#fff;color:#000}header,section,.metric{break-inside:avoid}}
</style></head><body><main class="layout"><header><p class="muted">Ixplorer diagnostic report · schema ${view.identity.schemaVersion}</p><h1>${escapeHtml(view.title)}</h1><p>Status: ${escapeHtml(view.outcome.status)}${view.identity.runId ? ` · Run ${escapeHtml(view.identity.runId)}` : ""}</p></header><div class="metrics">${metrics}</div>${findings}${timeline}${sections}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

function escapeAttribute(value: string): string {
  return escapeHtml(value.replace(/[^a-zA-Z0-9_-]/g, "-"));
}
