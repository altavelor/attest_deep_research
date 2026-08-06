import { DiagnosticReportV3, Finding } from "@apps/obsidian/ui/diagnostics/report/types";
import { summaryMetrics, webSourceSelectionHtml, webSourceSelectionsHtml } from "../report/format";
import {
  attr,
  badge,
  BadgeVariant,
  callout,
  collapsedCard,
  dl,
  h,
  sub,
  tag,
  utilizationBar,
  yesNo,
} from "./primitives";

const NAV_SECTIONS = ["findings", "run-trace", "input", "internals"];

export function renderNav(report: DiagnosticReportV3): string {
  const anchors = NAV_SECTIONS.filter(
    (id) => id !== "findings" || report.findings.findings.length > 0,
  )
    .map((id) => `<a class="nav-anchor" href="#${attr(id)}">${h(id)}</a>`)
    .join("");
  return `<nav class="top-nav" aria-label="Sections"><span class="nav-brand">Ixplorer</span><span class="nav-label">Diagnostic report</span><div class="nav-anchors">${anchors}</div></nav>`;
}

export function renderHeader(report: DiagnosticReportV3): string {
  const { stats, model } = report;
  const statusVariant: BadgeVariant =
    stats.status === "completed" ? "success" : stats.status === "failed" ? "danger" : "neutral";
  const strategyVariant: BadgeVariant =
    model.executionStrategy === "thinking" ? "accent" : "neutral";
  const fallback = report.reasoning.thinkingLoop?.fallbackReason;

  const badges = [
    badge(stats.status || "unknown", statusVariant),
    model.executionStrategy ? badge(model.executionStrategy, strategyVariant) : "",
    model.name ? badge(model.name, "neutral") : "",
    fallback ? badge(`fallback: ${fallback}`, "danger") : "",
  ]
    .filter(Boolean)
    .join("");

  const metrics = summaryMetrics(report)
    .map(
      (metric) =>
        `<div class="metric"><span>${h(metric.label)}</span><strong>${h(metric.value)}</strong></div>`,
    )
    .join("");

  return `<header class="page-header" id="header">
    <p class="eyebrow">Ixplorer diagnostic report · v3</p>
    <p class="question-text">${h(report.question || "(no question recorded)")}</p>
    <div class="header-badges">${badges}</div>
    ${stats.runId ? `<p class="meta mono">${h(stats.runId)}${stats.answerId ? ` · ${h(stats.answerId)}` : ""}</p>` : ""}
    <div class="metric-strip">${metrics}</div>
  </header>`;
}

export function renderFindings(findings: DiagnosticReportV3["findings"]): string {
  if (findings.findings.length === 0) return "";
  const items = findings.findings.map((f) => renderFinding(f)).join("");
  const body = `<p class="findings-summary">${h(findings.summary)}</p>${items}`;
  return `<section class="card" id="findings"><header class="card-eyebrow">Findings</header><div class="card-body">${body}</div></section>`;
}

function renderFinding(f: Finding): string {
  const variant: BadgeVariant =
    f.severity === "error" ? "danger" : f.severity === "warning" ? "warning" : "neutral";
  const evidenceChips = Object.entries(f.evidence)
    .map(([k, v]) => `<code>${h(k)}: ${h(JSON.stringify(v))}</code>`)
    .join(" ");
  return `<div class="finding finding-${attr(f.severity)}">
    <div class="finding-header">
      <strong>${h(f.title)}</strong>
      ${badge(f.affectedSection, variant)}
    </div>
    <p class="finding-detail">${h(f.detail)}</p>
    ${evidenceChips ? `<p class="finding-evidence">${evidenceChips}</p>` : ""}
  </div>`;
}

export function renderInput(report: DiagnosticReportV3): string {
  const body = [
    policyBody(report),
    contextBody(report),
    retrievalBody(report),
    webBody(report),
    modelBody(report),
    warningsBody(report),
  ]
    .filter(Boolean)
    .join("");
  return collapsedCard("input", "Input", body);
}

function policyBody(report: DiagnosticReportV3): string {
  const { request } = report;
  return (
    sub("Thinking policy") +
    dl([
      ["Search mode", h(request.searchMode)],
      ["Policy reason", `<code>${h(request.thinkingPolicy.policyReason)}</code>`],
      [
        "Bootstrap choice",
        request.thinkingPolicy.bootstrapChoice
          ? `<code>${h(JSON.stringify(request.thinkingPolicy.bootstrapChoice))}</code>`
          : badge("none", "neutral"),
      ],
      [
        "Required tools",
        request.thinkingPolicy.requiredTools.length > 0
          ? request.thinkingPolicy.requiredTools.map(tag).join("")
          : badge("none", "neutral"),
      ],
    ])
  );
}

function contextBody(report: DiagnosticReportV3): string {
  const { preflight } = report;
  let html = "";

  const budget = preflight.context.budget;
  const limitStr = budget.limitTokens !== null ? h(budget.limitTokens) : "∞";
  const pctStr = budget.utilizationPct !== null ? ` (${h(budget.utilizationPct)}%)` : "";
  html += sub("Token budget");
  html += utilizationBar(budget.utilizationPct);
  html += `<p class="budget-label">${h(budget.usedTokens)} / ${limitStr} tokens${pctStr}</p>`;
  if (budget.groups.length > 0) {
    const rows = budget.groups
      .map(
        (g) =>
          `<tr><td>${h(g.name)}</td><td>${h(g.usedTokens)}</td><td>${h(g.allocatedTokens ?? "—")}</td><td>${h(g.includedItems ?? "—")}</td><td>${h(g.droppedItems)}</td></tr>`,
      )
      .join("");
    html += `<table class="data-table"><thead><tr><th>Group</th><th>Used tokens</th><th>Allocated</th><th>Included</th><th>Dropped</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const allSources = preflight.context.sources;
  if (allSources.length > 0) {
    const rows = allSources
      .map((s) => {
        const statusV: BadgeVariant =
          s.status === "included" ? "success" : s.status === "failed" ? "danger" : "neutral";
        const path = s.path.length > 60 ? s.path.slice(0, 57) + "…" : s.path;
        return `<tr><td class="mono">${h(path)}</td><td>${tag(s.role)}</td><td>${badge(s.status, statusV)}</td><td>${h(s.includedTokens ?? 0)}</td></tr>`;
      })
      .join("");
    html +=
      sub("Context sources") +
      `<table class="data-table"><thead><tr><th>Path</th><th>Role</th><th>Status</th><th>Tokens</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  if (preflight.index) {
    const idx = preflight.index;
    html +=
      sub("Index") +
      dl([
        ["Status", h(idx.status)],
        ["Available", yesNo(idx.available)],
        ["Stale", yesNo(idx.isStale)],
        ["Indexed files", h(idx.indexedFiles)],
      ]);
    if (idx.errorMessage)
      html += callout("danger", `<strong>Error:</strong> ${h(idx.errorMessage)}`);
  }

  return html;
}

function retrievalBody(report: DiagnosticReportV3): string {
  const retrieval = report.request.retrieval;
  if (!retrieval) return "";
  let html = "";
  if (retrieval.queryVariants.length > 0) {
    html +=
      sub("Query variants") +
      `<ol>${retrieval.queryVariants.map((q) => `<li>${h(q)}</li>`).join("")}</ol>`;
  }
  if (retrieval.rankedChunks.length > 0) {
    const rows = retrieval.rankedChunks
      .map((c) => {
        const statusV: BadgeVariant =
          c.status === "included" ? "success" : c.status === "dropped" ? "warning" : "neutral";
        const id12 = c.id.length > 12 ? c.id.slice(0, 12) + "…" : c.id;
        const dropR = c.dropReason ? tag(c.dropReason) : "";
        return `<tr><td>${h(c.rank)}</td><td class="mono">${h(id12)}</td><td class="mono">${h(c.path)}</td><td>${h(c.score.toFixed(3))}</td><td>${badge(c.status, statusV)}${dropR}</td></tr>`;
      })
      .join("");
    html +=
      sub("Ranked chunks") +
      `<table class="data-table"><thead><tr><th>#</th><th>ID</th><th>Path</th><th>Score</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return html;
}

function webBody(report: DiagnosticReportV3): string {
  const web = report.request.web;
  const thinkingSelections = webSourceSelectionsHtml(
    report.request.webSourceSelections,
    report.request.omittedWebSourceSelections,
  );
  if (!web) return thinkingSelections;
  const included = web.results.filter((r) => r.status === "included").length;
  const dropped = web.results.filter((r) => r.status === "dropped").length;
  return (
    sub("Web search (preflight)") +
    dl([
      ["Query strategy", badge(web.queryStrategy, "neutral")],
      ["Queries", web.queries.map((q) => `<code>${h(q)}</code>`).join(", ")],
      ["Results", `${h(included)} included / ${h(dropped)} dropped of ${h(web.results.length)}`],
      ["Prompt tokens", h(web.finalPrompt.usedTokens)],
    ]) +
    webSourceSelectionHtml(report.request.webSourceSelection) +
    thinkingSelections
  );
}

function modelBody(report: DiagnosticReportV3): string {
  const { model } = report;
  const tc = model.toolCapabilities;
  const capRows = (["calls", "choiceRequired", "choiceSpecific", "parallelCalls"] as const)
    .map(
      (flag) =>
        `<tr><td>${h(flag)}</td><td>${yesNo(tc[flag])}</td><td>${badge(tc.provenance[flag] ?? "—", "neutral")}</td></tr>`,
    )
    .join("");
  let html =
    sub("Model") +
    dl([
      ["Model", h(model.name || "(unknown)")],
      ["API format", h(model.apiFormat ?? "(unknown)")],
      ...(model.reasoning
        ? ([
            ["Reasoning protocol", h(model.reasoning.protocol)],
            ["Configured effort", h(model.reasoning.configuredEffort ?? "—")],
          ] as Array<[string, string]>)
        : []),
    ]);
  html += `<table class="data-table"><thead><tr><th>Capability</th><th>Value</th><th>Provenance</th></tr></thead><tbody>${capRows}</tbody></table>`;
  if (tc.probe) {
    const p = tc.probe;
    const inconsistent = p.rawCapabilities.calls !== tc.calls;
    const probeRows = (["required", "specific", "auto"] as const)
      .map(
        (mode) =>
          `<tr><td><code>${h(mode)}</code></td><td>${p.results[mode].length > 0 ? p.results[mode].map(tag).join("") : badge("none", "neutral")}</td></tr>`,
      )
      .join("");
    html +=
      sub("Probe audit") +
      dl([
        ["Ran at", h(p.ranAt)],
        ["Model", h(p.modelName)],
        ["API format", h(p.apiFormat)],
      ]) +
      `<table class="data-table"><thead><tr><th>Mode</th><th>Tools returned</th></tr></thead><tbody>${probeRows}</tbody></table>` +
      (inconsistent
        ? callout(
            "warning",
            `<strong>Probe overridden by manual settings.</strong> Probe found <code>calls=${p.rawCapabilities.calls}</code>, effective value is <code>calls=${tc.calls}</code>.`,
          )
        : "");
  }
  return html;
}

function warningsBody(report: DiagnosticReportV3): string {
  const warnings = report.preflight.warnings;
  if (warnings.length === 0) return "";
  return (
    sub("Warnings") +
    callout("warning", `<ul>${warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul>`)
  );
}

export function renderInternals(report: DiagnosticReportV3): string {
  const { reasoning, answer } = report;
  let html = "";

  if (reasoning.stream) {
    const s = reasoning.stream;
    const termV: BadgeVariant = s.terminalEventObserved ? "success" : "warning";
    html +=
      sub("Stream") +
      dl([
        ["Protocol", `${h(s.protocol)} (${h(s.protocolSource)})`],
        [
          "Dialects",
          s.observedDialects.length > 0
            ? s.observedDialects.map(tag).join("")
            : badge("none", "neutral"),
        ],
        ["Frames / malformed", `${h(s.frameCount)} / ${h(s.malformedFrameCount)}`],
        [
          "Reasoning Δ / Text Δ / Tool Δ",
          `${h(s.reasoningDeltaCount)} / ${h(s.textDeltaCount)} / ${h(s.toolDeltaCount)}`,
        ],
        ["Terminal event", badge(String(s.terminalEventObserved), termV)],
        ...(s.firstByteMs !== undefined
          ? [["First byte", `${h(s.firstByteMs)} ms`] as [string, string]]
          : []),
      ]);
    if (s.warnings.length > 0) {
      html += callout("warning", `<ul>${s.warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul>`);
    }
  }

  if (reasoning.attempts.length > 0) {
    const rows = reasoning.attempts
      .map(
        (a) =>
          `<tr><td>${h(a.attempt)}</td><td>${h(a.protocol)}</td><td>${h(a.status)}</td><td>${yesNo(a.outputEmitted)}</td><td>${h(a.errorCode ?? "—")}</td></tr>`,
      )
      .join("");
    html +=
      sub("Attempts") +
      `<table class="data-table"><thead><tr><th>#</th><th>Protocol</th><th>Status</th><th>Output</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  if (answer.projection) {
    const p = answer.projection;
    html +=
      sub("Projection") +
      dl([
        ["Reasoning segments", h(p.reasoningSegments)],
        [
          "Checkpoints / final commits",
          `${h(p.checkpointsCreated)} / ${h(p.finalAnswersCommitted)}`,
        ],
        ["Buffered text chars", h(p.bufferedTextChars)],
      ]);
  }

  if (answer.delivery) {
    const d = answer.delivery;
    const persV: BadgeVariant =
      d.persistenceStatus === "saved"
        ? "success"
        : d.persistenceStatus === "failed"
          ? "danger"
          : "neutral";
    html +=
      sub("Delivery") +
      dl([
        [
          "Events / UI patches / renders",
          `${h(d.projectorEventsReceived)} / ${h(d.uiPatchesApplied)} / ${h(d.markdownRenders)}`,
        ],
        ["Coalesced updates", h(d.coalescedUpdates)],
        ["Persistence", badge(d.persistenceStatus, persV)],
      ]);
  }

  if (answer.unknownCitationIds.length > 0) {
    const chips = answer.unknownCitationIds.map((id) => `<code>${h(id)}</code>`).join(" ");
    html += callout("danger", `<strong>Unknown citation IDs:</strong> ${chips}`);
  }

  if (answer.unverifiedCitations.length > 0) {
    const chips = answer.unverifiedCitations.map((id) => `<code>${h(id)}</code>`).join(" ");
    html += callout(
      "warning",
      `<strong>Unverified citations (claim ≁ source text):</strong> ${chips}`,
    );
  }

  if (!html) return "";
  return collapsedCard("internals", "Internals", html);
}
