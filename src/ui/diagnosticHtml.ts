import { ContextDiagnostics } from "../shared/types";
import { buildDiagnosticReportV3, DiagnosticReportV3, Finding } from "./diagnosticReportV3";

export function formatDiagnosticReportHtml(diagnostics: ContextDiagnostics): string {
  const report = buildDiagnosticReportV3(diagnostics);
  return renderHtml(report);
}

// ─── Escape helpers ───────────────────────────────────────────────────────────

function h(value: unknown): string {
  const str = String(value ?? "");
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function attr(value: unknown): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
}

// ─── Component primitives ─────────────────────────────────────────────────────

type BadgeVariant = "success" | "warning" | "danger" | "accent" | "neutral";

function badge(text: string, variant: BadgeVariant = "neutral"): string {
  return `<span class="badge badge-${attr(variant)}">${h(text)}</span>`;
}

function tag(text: string): string {
  return `<span class="tag">${h(text)}</span>`;
}

function yesNo(value: boolean): string {
  return value ? badge("yes", "success") : badge("no", "neutral");
}

function dl(rows: Array<[string, string]>): string {
  return `<dl class="def-list">${rows.map(([label, value]) => `<div><dt>${h(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;
}

function card(id: string, eyebrow: string, body: string): string {
  return `<section class="card" id="${attr(id)}"><header class="card-eyebrow">${h(eyebrow)}</header><div class="card-body">${body}</div></section>`;
}

function sub(title: string): string {
  return `<h4 class="sub-heading">${h(title)}</h4>`;
}

function callout(variant: BadgeVariant, html: string): string {
  return `<div class="callout callout-${attr(variant)}">${html}</div>`;
}

function utilizationBar(pct: number | null): string {
  if (pct === null) return "";
  const clamped = Math.min(100, Math.max(0, pct));
  const colour = pct > 90 ? "danger" : pct > 75 ? "warning" : "success";
  return `<div class="util-bar" role="meter" aria-valuenow="${h(clamped)}" aria-valuemax="100"><div class="util-fill util-fill-${attr(colour)}" style="width:${h(clamped)}%"></div></div>`;
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

const NAV_SECTIONS = ["findings", "model", "preflight", "request", "reasoning", "answer", "timeline", "warnings"];

function renderNav(report: DiagnosticReportV3): string {
  const anchors = NAV_SECTIONS
    .filter((id) => {
      if (id === "findings" && report.findings.findings.length === 0) return false;
      if (id === "warnings" && report.preflight.warnings.length === 0) return false;
      return true;
    })
    .map((id) => `<a class="nav-anchor" href="#${attr(id)}">${h(id)}</a>`)
    .join("");
  return `<nav class="top-nav" aria-label="Sections"><span class="nav-brand">Ixplorer</span><span class="nav-label">Diagnostic report</span><div class="nav-anchors">${anchors}</div></nav>`;
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(report: DiagnosticReportV3): string {
  const { stats, model, request } = report;
  const statusVariant: BadgeVariant = stats.status === "completed" ? "success" : stats.status === "failed" ? "danger" : "neutral";
  const strategyVariant: BadgeVariant = model.executionStrategy === "agentic" ? "accent" : "neutral";

  const meta1 = [
    stats.startedAt ? `Started ${h(stats.startedAt)}` : null,
    stats.durationMs ? `${h(stats.durationMs)} ms` : null,
    stats.lastPhase ? `last phase: ${h(stats.lastPhase)}` : null,
  ].filter(Boolean).join(" · ");

  const agentic = report.reasoning.agenticLoop;
  const meta2Parts: string[] = [];
  if (request.agenticPolicy.policyReason) meta2Parts.push(`policy: <code>${h(request.agenticPolicy.policyReason)}</code>`);
  if (agentic?.fallbackReason) meta2Parts.push(badge(`fallback: ${agentic.fallbackReason}`, "danger"));
  if (request.agenticPolicy.requiredTools.length > 0) meta2Parts.push(`required: ${request.agenticPolicy.requiredTools.map(tag).join("")}`);
  if (agentic?.satisfiedTools && agentic.satisfiedTools.length > 0) meta2Parts.push(`satisfied: ${agentic.satisfiedTools.map((t) => `<span class="tag tag-success">${h(t)}</span>`).join("")}`);

  return `<header class="page-header" id="header">
    <p class="eyebrow">Ixplorer diagnostic report · v3</p>
    <p class="question-text">${h(report.question || "(no question recorded)")}</p>
    <div class="header-badges">${badge(stats.status, statusVariant)}${model.executionStrategy ? badge(model.executionStrategy, strategyVariant) : ""}</div>
    ${stats.runId ? `<p class="meta mono">${h(stats.runId)}${stats.answerId ? ` · ${h(stats.answerId)}` : ""}</p>` : ""}
    ${meta1 ? `<p class="meta">${meta1}</p>` : ""}
    ${meta2Parts.length > 0 ? `<p class="meta">${meta2Parts.join(" &nbsp;·&nbsp; ")}</p>` : ""}
  </header>`;
}

// ─── Findings ─────────────────────────────────────────────────────────────────

function renderFindings(findings: DiagnosticReportV3["findings"]): string {
  if (findings.findings.length === 0) return "";
  const items = findings.findings.map((f) => renderFinding(f)).join("");
  const body = `<p class="findings-summary">${h(findings.summary)}</p>${items}`;
  return card("findings", "Findings", body);
}

function renderFinding(f: Finding): string {
  const variant: BadgeVariant = f.severity === "error" ? "danger" : f.severity === "warning" ? "warning" : "neutral";
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

// ─── Model ────────────────────────────────────────────────────────────────────

function renderModel(report: DiagnosticReportV3): string {
  const { model } = report;
  const tc = model.toolCapabilities;

  const defRows: Array<[string, string]> = [
    ["Model", model.name || "(unknown)"],
    ["API format", model.apiFormat ?? "(unknown)"],
    ["Execution strategy", badge(model.executionStrategy, model.executionStrategy === "agentic" ? "accent" : "neutral")],
  ];
  if (model.reasoning) {
    defRows.push(
      ["Reasoning protocol", h(model.reasoning.protocol)],
      ["Capability source", h(model.reasoning.capabilitySource ?? "—")],
      ["Configured effort", h(model.reasoning.configuredEffort ?? "—")],
      ["Summary requested", yesNo(model.reasoning.summaryRequested)],
      ["Summary available", yesNo(model.reasoning.summaryAvailable)],
    );
  }

  const capRows = (["calls", "choiceRequired", "choiceSpecific", "parallelCalls"] as const).map(
    (flag) => `<tr><td>${h(flag)}</td><td>${yesNo(tc[flag])}</td><td>${badge(tc.provenance[flag] ?? "—", "neutral")}</td></tr>`
  ).join("");
  const capTable = `${sub("Tool capabilities")}<table class="data-table"><thead><tr><th>Flag</th><th>Value</th><th>Provenance</th></tr></thead><tbody>${capRows}</tbody></table>`;

  let probeBlock = "";
  if (tc.probe) {
    const p = tc.probe;
    const inconsistent = p.rawCapabilities.calls !== tc.calls;
    const probeRows = (["required", "specific", "auto"] as const).map(
      (mode) => `<tr><td><code>${h(mode)}</code></td><td>${p.results[mode].length > 0 ? p.results[mode].map(tag).join("") : badge("none", "neutral")}</td></tr>`
    ).join("");
    probeBlock = `${sub("Probe audit")}
      ${dl([["Ran at", h(p.ranAt)], ["Model", h(p.modelName)], ["API format", h(p.apiFormat)]])}
      <table class="data-table"><thead><tr><th>Mode</th><th>Tools returned</th></tr></thead><tbody>${probeRows}</tbody></table>
      ${inconsistent ? callout("warning", `<strong>Probe overridden by manual settings.</strong> Probe found <code>calls=${p.rawCapabilities.calls}</code>, effective value is <code>calls=${tc.calls}</code>.`) : ""}`;
  }

  return card("model", "Model", dl(defRows) + capTable + probeBlock);
}

// ─── Preflight ────────────────────────────────────────────────────────────────

function renderPreflight(report: DiagnosticReportV3): string {
  const { preflight } = report;
  let html = "";

  if (preflight.index) {
    const idx = preflight.index;
    const rows: Array<[string, string]> = [
      ["Status", h(idx.status)],
      ["Available", yesNo(idx.available)],
      ["Stale", yesNo(idx.isStale)],
      ["Indexed files", h(idx.indexedFiles)],
    ];
    html += sub("Index") + dl(rows);
    if (idx.errorMessage) html += callout("danger", `<strong>Error:</strong> ${h(idx.errorMessage)}`);
  }

  if (preflight.indexDescription) {
    const id = preflight.indexDescription;
    const freshnessVariant: BadgeVariant = id.freshness === "current" ? "success" : id.freshness === "stale" ? "warning" : "danger";
    html += sub("Index description") + dl([
      ["Freshness", badge(id.freshness, freshnessVariant)],
      ["Algorithm version", h(id.algorithmVersion)],
      ["Chunk count", h(id.representativeChunkCount)],
      ["Generated at", h(id.generatedAt)],
      ["Truncated", yesNo(id.truncated)],
    ]);
  }

  // Sources
  const allSources = preflight.context.sources;
  if (allSources.length > 0) {
    const rows = allSources.map((s) => {
      const statusV: BadgeVariant = s.status === "included" ? "success" : s.status === "failed" ? "danger" : "neutral";
      const path = s.path.length > 60 ? s.path.slice(0, 57) + "…" : s.path;
      return `<tr><td class="mono">${h(path)}</td><td>${tag(s.role)}</td><td>${badge(s.status, statusV)}</td><td>${h(s.includedTokens ?? 0)}</td></tr>`;
    }).join("");
    html += sub("Context sources") + `<table class="data-table"><thead><tr><th>Path</th><th>Role</th><th>Status</th><th>Tokens</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // Budget
  const budget = preflight.context.budget;
  const limitStr = budget.limitTokens !== null ? h(budget.limitTokens) : "∞";
  const pctStr = budget.utilizationPct !== null ? ` (${h(budget.utilizationPct)}%)` : "";
  html += sub("Token budget");
  html += utilizationBar(budget.utilizationPct);
  html += `<p class="budget-label">${h(budget.usedTokens)} / ${limitStr} tokens${pctStr}</p>`;
  if (budget.groups.length > 0) {
    const rows = budget.groups.map(
      (g) => `<tr><td>${h(g.name)}</td><td>${h(g.usedTokens)}</td><td>${h(g.allocatedTokens ?? "—")}</td><td>${h(g.includedItems ?? "—")}</td><td>${h(g.droppedItems)}</td></tr>`
    ).join("");
    html += `<table class="data-table"><thead><tr><th>Group</th><th>Used tokens</th><th>Allocated</th><th>Included</th><th>Dropped</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  if (preflight.warnings.length > 0) {
    html += sub("Warnings") + callout("warning", `<ul>${preflight.warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul>`);
  }

  return card("preflight", "Preflight", html);
}

// ─── Request ──────────────────────────────────────────────────────────────────

function renderRequest(report: DiagnosticReportV3): string {
  const { request } = report;
  let html = "";

  html += sub("Agentic policy") + dl([
    ["Policy reason", `<code>${h(request.agenticPolicy.policyReason)}</code>`],
    ["Bootstrap choice", request.agenticPolicy.bootstrapChoice
      ? `<code>${h(JSON.stringify(request.agenticPolicy.bootstrapChoice))}</code>`
      : badge("none", "neutral")],
    ["Required tools", request.agenticPolicy.requiredTools.length > 0
      ? request.agenticPolicy.requiredTools.map(tag).join("")
      : badge("none", "neutral")],
  ]);

  const retrieval = request.retrieval;
  if (retrieval) {
    if (retrieval.queryVariants.length > 0) {
      html += sub("Query variants") + `<ol>${retrieval.queryVariants.map((q) => `<li>${h(q)}</li>`).join("")}</ol>`;
    }

    // Score stats
    if (retrieval.scoreStats) {
      const { min, max, avg, threshold } = retrieval.scoreStats;
      const statStr = `min ${min.toFixed(3)} &nbsp;·&nbsp; avg ${avg.toFixed(3)} &nbsp;·&nbsp; max ${max.toFixed(3)}`;
      const thresholdStr = threshold !== null ? ` &nbsp;|&nbsp; threshold ${threshold.toFixed(3)}` : "";
      html += sub("Retrieval scores") + `<p class="score-stats">${statStr}${thresholdStr}</p>`;
      if (threshold !== null && avg < threshold) {
        html += callout("warning", "<strong>Average score below threshold</strong> — retrieval may have poor coverage.");
      }
    }

    if (retrieval.rankedChunks.length > 0) {
      const threshold = retrieval.scoreStats?.threshold ?? null;
      const rows = retrieval.rankedChunks.map((c) => {
        const statusV: BadgeVariant = c.status === "included" ? "success" : c.status === "dropped" ? "warning" : "neutral";
        const scoreAbove = threshold !== null && c.score >= threshold;
        const scoreBelow = threshold !== null && c.score < threshold;
        const scoreClass = scoreAbove ? "score-above" : scoreBelow ? "score-below" : "";
        const scoreCell = `<span class="${attr(scoreClass)}">${h(c.score.toFixed(3))}</span>${threshold !== null ? ` <span class="muted">(thr ${h(threshold.toFixed(3))})</span>` : ""}`;
        const id12 = c.id.length > 12 ? c.id.slice(0, 12) + "…" : c.id;
        const dropR = c.dropReason ? tag(c.dropReason) : "";
        return `<tr><td>${h(c.rank)}</td><td class="mono">${h(id12)}</td><td class="mono">${h(c.path)}</td><td>${scoreCell}</td><td>${badge(c.status, statusV)}${dropR}</td></tr>`;
      }).join("");
      html += sub("Ranked chunks") + `<table class="data-table"><thead><tr><th>#</th><th>ID</th><th>Path</th><th>Score</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  }

  // Evidence planner
  if (request.evidencePlanner) {
    const ep = request.evidencePlanner;
    html += sub("Evidence planner") + dl([
      ["Policy", badge(ep.budget.policy, "neutral")],
      ["Evidence limit", h(ep.budget.evidenceLimit)],
      ["Web intent", `${yesNo(ep.webIntent.detected)} ${ep.webIntent.reason !== "none" ? badge(ep.webIntent.reason, "neutral") : ""}`],
      ["Local quality weak", `${yesNo(ep.localEvidenceQuality.weak)}${ep.localEvidenceQuality.reasons.length > 0 ? " " + ep.localEvidenceQuality.reasons.map(tag).join("") : ""}`],
    ]);
    const dropped = ep.dropped;
    const droppedTotal =
      dropped.explicitChunkIds.length +
      dropped.graphChunkIds.length +
      dropped.retrievalChunkIds.length +
      dropped.webChunkIds.length;
    if (droppedTotal > 0) {
      html += `<table class="data-table"><thead><tr><th>Dropped type</th><th>Count</th></tr></thead><tbody>
        <tr><td>explicit</td><td>${h(dropped.explicitChunkIds.length)}</td></tr>
        <tr><td>graph</td><td>${h(dropped.graphChunkIds.length)}</td></tr>
        <tr><td>retrieval</td><td>${h(dropped.retrievalChunkIds.length)}</td></tr>
        <tr><td>web</td><td>${h(dropped.webChunkIds.length)}</td></tr>
      </tbody></table>`;
    }
  }

  // Web
  if (request.web) {
    const web = request.web;
    const included = web.results.filter((r) => r.status === "included").length;
    const dropped = web.results.filter((r) => r.status === "dropped").length;
    html += sub("Web search") + dl([
      ["Query strategy", badge(web.queryStrategy, "neutral")],
      ["Queries", web.queries.map((q) => `<code>${h(q)}</code>`).join(", ")],
      ["Results", `${h(included)} included / ${h(dropped)} dropped of ${h(web.results.length)}`],
      ["Prompt tokens", h(web.finalPrompt.usedTokens)],
    ]);
  }

  return card("request", "Request", html);
}

// ─── Reasoning ────────────────────────────────────────────────────────────────

function renderReasoning(report: DiagnosticReportV3): string {
  const { reasoning } = report;
  let html = "";

  // Stream
  if (reasoning.stream) {
    const s = reasoning.stream;
    const termV: BadgeVariant = s.terminalEventObserved ? "success" : "warning";
    html += sub("Stream") + dl([
      ["Protocol", h(s.protocol)],
      ["Source", badge(s.protocolSource, "neutral")],
      ["Dialects", s.observedDialects.length > 0 ? s.observedDialects.map(tag).join("") : badge("none", "neutral")],
      ["Frames", h(s.frameCount)],
      ["Malformed frames", h(s.malformedFrameCount)],
      ["Reasoning Δ / Text Δ / Tool Δ", `${h(s.reasoningDeltaCount)} / ${h(s.textDeltaCount)} / ${h(s.toolDeltaCount)}`],
      ["Terminal event", badge(String(s.terminalEventObserved), termV)],
      ...(s.firstByteMs !== undefined ? [["First byte", `${h(s.firstByteMs)} ms`] as [string, string]] : []),
      ...(s.firstReasoningMs !== undefined ? [["First reasoning", `${h(s.firstReasoningMs)} ms`] as [string, string]] : []),
    ]);
    if (s.warnings.length > 0) {
      html += callout("warning", `<ul>${s.warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul>`);
    }
  }

  // Agentic loop
  if (reasoning.agenticLoop) {
    const loop = reasoning.agenticLoop;
    const budgets = loop.budgets;
    html += sub("Agentic loop") + dl([
      ["Rounds", budgets ? `${h(loop.totalRounds)} / ${h(budgets.maxRounds)}` : h(loop.totalRounds)],
      ["Total calls", h(loop.totalCalls)],
      ["Duplicate calls", h(loop.duplicateCalls)],
      ["Result chars", budgets ? `${h(budgets.usedResultChars)} / ${h(budgets.maxResultChars)}` : "—"],
      ["Satisfied tools", loop.satisfiedTools.length > 0 ? loop.satisfiedTools.map((t) => `<span class="tag tag-success">${h(t)}</span>`).join("") : badge("none", "neutral")],
      ["Repaired tools", loop.repairedTools.length > 0 ? loop.repairedTools.map(tag).join("") : badge("none", "neutral")],
      ...(loop.fallbackReason ? [["Fallback reason", badge(loop.fallbackReason, "danger")] as [string, string]] : []),
      ["Stop reasons", loop.stopReasons.length > 0 ? loop.stopReasons.map(tag).join("") : badge("none", "neutral")],
    ]);

    // Per-round breakdown
    if (loop.rounds.length > 0) {
      const roundRows = loop.rounds.map((r) => {
        const phaseV: BadgeVariant = r.phase === "bootstrap" ? "accent" : r.phase === "repair" ? "warning" : "neutral";
        const classV: BadgeVariant = r.classification === "final" ? "success" : r.classification === "discarded" ? "danger" : "neutral";
        const toolCallDetails = r.toolCalls.map((tc) => {
          const statusV: BadgeVariant = tc.status === "success" ? "success" : tc.status === "failed" ? "danger" : "neutral";
          const argsPreview = JSON.stringify(tc.arguments).slice(0, 120);
          return `<div class="round-call">${badge(tc.status, statusV)} <code>${h(tc.name)}</code> ${tc.resultBytes !== undefined ? `${h(tc.resultBytes)} B` : ""}<pre class="args-pre">${h(argsPreview)}</pre></div>`;
        }).join("");
        const expandable = toolCallDetails
          ? `<details><summary>${h(r.toolCalls.length)} tool call(s)</summary>${toolCallDetails}</details>`
          : badge("0 calls", "neutral");
        return `<tr>
          <td>${h(r.round)}</td>
          <td>${badge(r.phase, phaseV)}</td>
          <td>${expandable}</td>
          <td>${yesNo(r.hadTextOutput)}</td>
          <td>${r.classification ? badge(r.classification, classV) : badge("—", "neutral")}</td>
        </tr>`;
      }).join("");
      html += sub("Per-round breakdown") + `<table class="data-table"><thead><tr><th>#</th><th>Phase</th><th>Tool calls</th><th>Text output</th><th>Classification</th></tr></thead><tbody>${roundRows}</tbody></table>`;
    }
  }

  // Tokens
  const tokens = reasoning.tokens;
  html += sub("Tokens") + dl([
    ["Input / Output / Reasoning", `${h(tokens.inputTokens)} / ${h(tokens.outputTokens)} / ${h(tokens.reasoningTokens)}`],
    ["Reasoning items", h(reasoning.reasoningItemCount)],
    ["Continuation rounds", h(reasoning.continuationRounds)],
  ]);

  return card("reasoning", "Reasoning", html);
}

// ─── Answer ───────────────────────────────────────────────────────────────────

function renderAnswer(report: DiagnosticReportV3): string {
  const { answer } = report;
  let html = "";

  if (answer.projection) {
    const p = answer.projection;
    html += sub("Projection") + dl([
      ["Reasoning segments", h(p.reasoningSegments)],
      ["Checkpoints created", h(p.checkpointsCreated)],
      ["Final commits", h(p.finalAnswersCommitted)],
      ["Buffered text chars", h(p.bufferedTextChars)],
      ["Stale events ignored", h(p.staleEventsIgnored)],
      ["Duplicate deltas ignored", h(p.duplicateDeltasIgnored)],
    ]);
    if (p.classifications.length > 0) {
      const rows = p.classifications.map(
        (c) => `<tr><td>${h(c.round)}</td><td>${badge(c.classification, c.classification === "final" ? "success" : "neutral")}</td><td>${h(c.reason)}</td></tr>`
      ).join("");
      html += `<table class="data-table"><thead><tr><th>Round</th><th>Classification</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
  }

  if (answer.delivery) {
    const d = answer.delivery;
    const persV: BadgeVariant = d.persistenceStatus === "saved" ? "success" : d.persistenceStatus === "failed" ? "danger" : "neutral";
    html += sub("Delivery") + dl([
      ["Projector events received", h(d.projectorEventsReceived)],
      ["UI patches applied", h(d.uiPatchesApplied)],
      ["Markdown renders", h(d.markdownRenders)],
      ["Persistence", badge(d.persistenceStatus, persV)],
    ]);
  }

  if (answer.unknownCitationIds.length > 0) {
    const chips = answer.unknownCitationIds.map((id) => `<code>${h(id)}</code>`).join(" ");
    html += callout("danger", `<strong>Unknown citation IDs:</strong> ${chips}`);
  }

  return card("answer", "Answer", html);
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

function renderTimeline(report: DiagnosticReportV3): string {
  const timeline = report.stats.timeline;
  if (!timeline || timeline.length === 0) return "";

  const rows: string[] = [];
  let prev: (typeof timeline)[0] | null = null;
  let repeat = 1;

  const flush = (event: (typeof timeline)[0], count: number) => {
    const detail = [event.status, event.reason].filter(Boolean).join(" · ");
    const repeatBadge = count > 1 ? ` <span class="repeat-badge">×${h(count)}</span>` : "";
    rows.push(`<tr><td class="mono">+${h(event.offsetMs)} ms</td><td>${h(event.type)}${repeatBadge}</td><td>${h(detail)}</td></tr>`);
  };

  for (const event of timeline) {
    if (
      prev &&
      prev.type === event.type &&
      !event.status &&
      !event.reason &&
      !prev.status &&
      !prev.reason
    ) {
      repeat += 1;
    } else {
      if (prev) flush(prev, repeat);
      prev = event;
      repeat = 1;
    }
  }
  if (prev) flush(prev, repeat);

  let html = `<table class="data-table"><thead><tr><th>Offset</th><th>Event</th><th>Detail</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  if (report.stats.omittedTimelineEvents) {
    html += `<p class="muted">${h(report.stats.omittedTimelineEvents)} event(s) omitted.</p>`;
  }
  return card("timeline", "Timeline", html);
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

function renderWarnings(report: DiagnosticReportV3): string {
  const warnings = report.preflight.warnings;
  if (warnings.length === 0) return "";
  return card("warnings", "Warnings", `<ul class="warnings-list">${warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul>`);
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --dr-bg:#f9f8f6;--dr-surface:#fff;--dr-surface-2:#f3f2ef;
  --dr-text:#1c1917;--dr-muted:#78716c;--dr-border:#e7e5e0;--dr-border-2:#d6d3ce;
  --dr-accent:#cc5200;--dr-accent-bg:#fff4ef;
  --dr-success:#166534;--dr-success-bg:#f0fdf4;--dr-success-border:#bbf7d0;
  --dr-warning:#92400e;--dr-warning-bg:#fffbeb;--dr-warning-border:#fde68a;
  --dr-danger:#991b1b;--dr-danger-bg:#fef2f2;--dr-danger-border:#fecaca;
  --dr-neutral-bg:#f3f4f6;--dr-neutral-text:#374151;
  color-scheme:light dark;
}
@media(prefers-color-scheme:dark){:root{
  --dr-bg:#111110;--dr-surface:#1c1b19;--dr-surface-2:#242320;
  --dr-text:#e8e4df;--dr-muted:#9c9791;--dr-border:#2e2c28;--dr-border-2:#3d3a35;
  --dr-accent:#f97316;--dr-accent-bg:#1c1007;
  --dr-success:#4ade80;--dr-success-bg:#052e16;--dr-success-border:#14532d;
  --dr-warning:#fbbf24;--dr-warning-bg:#1c1000;--dr-warning-border:#451a03;
  --dr-danger:#f87171;--dr-danger-bg:#1c0606;--dr-danger-border:#450a0a;
  --dr-neutral-bg:#1f2937;--dr-neutral-text:#d1d5db;
}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--dr-bg);color:var(--dr-text);font:14px/1.6 'Inter',system-ui,-apple-system,sans-serif}
.layout{width:min(960px,calc(100% - 32px));margin:auto;padding:24px 0 48px}
code,pre,.mono{font-family:'JetBrains Mono','Fira Code',ui-monospace,monospace;font-size:12px}
a{color:var(--dr-accent)}

/* Nav */
.top-nav{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;height:48px;padding:0 16px;background:var(--dr-surface);border-bottom:1px solid var(--dr-border)}
.nav-brand{font-weight:700;color:var(--dr-accent)}
.nav-label{color:var(--dr-muted);font-size:13px}
.nav-anchors{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.nav-anchor{font-size:12px;text-decoration:none;padding:2px 8px;border-radius:99px;background:var(--dr-surface-2);color:var(--dr-muted)}
.nav-anchor:hover{color:var(--dr-text)}

/* Page header */
.page-header{margin-bottom:16px;padding:24px;border:1px solid var(--dr-border);border-radius:12px;background:var(--dr-surface)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dr-muted);margin-bottom:8px}
.question-text{font-size:17px;font-weight:500;margin-bottom:12px}
.header-badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.meta{font-size:13px;color:var(--dr-muted);margin-top:4px}

/* Cards */
.card{margin-bottom:16px;border:1px solid var(--dr-border);border-radius:12px;background:var(--dr-surface);overflow:hidden}
.card-eyebrow{padding:8px 20px;background:var(--dr-surface-2);font-size:13px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--dr-muted);border-bottom:1px solid var(--dr-border)}
.card-body{padding:20px 24px}
.sub-heading{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dr-muted);margin-top:20px;margin-bottom:8px}
.sub-heading:first-child{margin-top:0}

/* Definition list */
.def-list{display:grid;grid-template-columns:minmax(160px,220px) 1fr;gap:0}
.def-list div{display:contents}
.def-list dt,.def-list dd{padding:7px 0;border-bottom:1px solid var(--dr-border);font-size:13px}
.def-list dt{color:var(--dr-muted)}
.def-list dd{padding-left:12px;overflow-wrap:anywhere}

/* Badges */
.badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:500;border:1px solid transparent;line-height:1.6}
.badge-success{background:var(--dr-success-bg);color:var(--dr-success);border-color:var(--dr-success-border)}
.badge-warning{background:var(--dr-warning-bg);color:var(--dr-warning);border-color:var(--dr-warning-border)}
.badge-danger{background:var(--dr-danger-bg);color:var(--dr-danger);border-color:var(--dr-danger-border)}
.badge-accent{background:var(--dr-accent-bg);color:var(--dr-accent)}
.badge-neutral{background:var(--dr-neutral-bg);color:var(--dr-neutral-text);border-color:var(--dr-border)}

/* Tags */
.tag,.tag-success{display:inline-flex;align-items:center;padding:1px 7px;border-radius:4px;font-size:12px;background:var(--dr-surface-2);color:var(--dr-muted);margin-right:3px}
.tag-success{background:var(--dr-success-bg);color:var(--dr-success)}

/* Callouts */
.callout{padding:12px 16px;border-radius:8px;border-left:4px solid;margin:12px 0;font-size:13px}
.callout-warning{background:var(--dr-warning-bg);border-color:var(--dr-warning);color:var(--dr-warning)}
.callout-danger{background:var(--dr-danger-bg);border-color:var(--dr-danger);color:var(--dr-danger)}
.callout-neutral{background:var(--dr-neutral-bg);border-color:var(--dr-border-2)}
.callout ul{padding-left:20px;margin-top:4px}

/* Data tables */
.data-table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
.data-table th{background:var(--dr-surface-2);padding:6px 10px;text-align:left;font-size:12px;font-weight:600;color:var(--dr-muted);border-bottom:1px solid var(--dr-border)}
.data-table td{padding:6px 10px;border-bottom:1px solid var(--dr-border);vertical-align:top}
.data-table tr:last-child td{border-bottom:none}

/* Utilization bar */
.util-bar{height:8px;border-radius:4px;background:var(--dr-surface-2);overflow:hidden;margin:8px 0 4px}
.util-fill{height:100%;border-radius:4px;transition:width .3s}
.util-fill-success{background:var(--dr-success)}
.util-fill-warning{background:var(--dr-warning)}
.util-fill-danger{background:var(--dr-danger)}
.budget-label{font-size:13px;color:var(--dr-muted);margin-bottom:8px}

/* Scores */
.score-above{color:var(--dr-success);font-weight:600}
.score-below{color:var(--dr-danger);font-weight:600}
.score-stats{font-size:13px;color:var(--dr-muted);margin:4px 0 8px}
.muted{color:var(--dr-muted);font-size:12px}

/* Findings */
.findings-summary{font-size:15px;margin-bottom:16px}
.finding{padding:12px 16px;border-radius:8px;border:1px solid var(--dr-border);margin-bottom:10px;position:relative;border-left-width:4px}
.finding-error{border-left-color:var(--dr-danger);background:var(--dr-danger-bg)}
.finding-warning{border-left-color:var(--dr-warning);background:var(--dr-warning-bg)}
.finding-info{border-left-color:var(--dr-border-2);background:var(--dr-surface-2)}
.finding-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:6px}
.finding-detail{font-size:13px;color:var(--dr-muted);margin:4px 0}
.finding-evidence{font-size:12px;margin-top:6px}
.finding-evidence code{margin-right:6px;background:var(--dr-surface-2);padding:1px 5px;border-radius:4px}

/* Agentic rounds */
.round-call{padding:6px 0;border-bottom:1px solid var(--dr-border);font-size:12px}
.round-call:last-child{border-bottom:none}
.args-pre{background:var(--dr-surface-2);padding:4px 8px;border-radius:4px;overflow-x:auto;margin-top:4px;font-size:11px;white-space:pre-wrap}
details>summary{cursor:pointer;font-size:12px;color:var(--dr-muted)}
.repeat-badge{font-size:11px;background:var(--dr-surface-2);padding:1px 6px;border-radius:99px;color:var(--dr-muted)}

/* Warnings list */
.warnings-list{padding-left:20px;color:var(--dr-warning)}
.warnings-list li{margin-bottom:4px;font-size:13px}

@media print{
  .top-nav{display:none}
  body{background:#fff;color:#000}
  .card{break-inside:avoid}
  details{display:block}
  details>summary{display:none}
}
`;

// ─── Main render ──────────────────────────────────────────────────────────────

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
