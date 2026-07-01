import { DiagnosticReportV3, Finding } from "@apps/obsidian/ui/diagnostics/report/types";
import {
  attr,
  badge,
  BadgeVariant,
  callout,
  card,
  dl,
  h,
  sub,
  tag,
  utilizationBar,
  yesNo,
} from "./primitives";

// ─── Nav ──────────────────────────────────────────────────────────────────────

const NAV_SECTIONS = ["findings", "model", "preflight", "request", "reasoning", "answer", "timeline", "warnings"];

export function renderNav(report: DiagnosticReportV3): string {
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

export function renderHeader(report: DiagnosticReportV3): string {
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

export function renderFindings(findings: DiagnosticReportV3["findings"]): string {
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

export function renderModel(report: DiagnosticReportV3): string {
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

export function renderPreflight(report: DiagnosticReportV3): string {
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

export function renderRequest(report: DiagnosticReportV3): string {
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

export function renderReasoning(report: DiagnosticReportV3): string {
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

export function renderAnswer(report: DiagnosticReportV3): string {
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

export function renderTimeline(report: DiagnosticReportV3): string {
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

export function renderWarnings(report: DiagnosticReportV3): string {
  const warnings = report.preflight.warnings;
  if (warnings.length === 0) return "";
  return card("warnings", "Warnings", `<ul class="warnings-list">${warnings.map((w) => `<li>${h(w)}</li>`).join("")}</ul>`);
}
