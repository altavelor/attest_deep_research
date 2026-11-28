import type { DeepResearchDiagnostics } from "@core/diagnostics";
import { collapsedCard, dl, h, sub } from "./primitives";

/** Renders the Deep Research block of a report with every recorded text escaped. */
export function renderDeepResearch(research: DeepResearchDiagnostics | null): string {
  if (!research) return "";
  const text = (value: string | number | null): string => h(value ?? "—");
  let body = dl([
    ["Research", text(research.researchId)],
    ["Turn", text(research.turnKind)],
    ["Phase", `${text(research.phaseBefore)} → ${text(research.phaseAfter)}`],
    ["Terminal reason", text(research.terminalReason)],
    ["Stop reason", text(research.stopReason)],
    ["Summary failure", text(research.summaryFailure ?? null)],
  ]);
  if (research.plan) {
    const rows = research.plan.branches
      .map(
        (branch) =>
          `<tr><td>${h(branch.branchId)}</td><td>${h(branch.title)}</td><td>${h(branch.sourceScope)}</td><td>${h(branch.priority)}</td><td>${h(branch.enabled)}</td></tr>`,
      )
      .join("");
    body += `${sub(`Plan revision ${research.plan.revision} · ${research.plan.preset}`)}<table class="data-table"><thead><tr><th>Branch</th><th>Title</th><th>Scope</th><th>Priority</th><th>Enabled</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (research.budget) {
    const { budget } = research;
    const rows = budget.consumed
      .map(
        (entry) =>
          `<tr><td>${h(entry.dimension)}</td><td>${h(entry.used)} / ${h(entry.limit)}</td></tr>`,
      )
      .join("");
    body += `${sub("Budget")}<table class="data-table"><tbody>${rows}<tr><td>activeMs</td><td>${h(budget.activeMs)} / ${text(budget.activeLimitMs)}</td></tr></tbody></table>`;
    body += dl([
      ["Closed", `${text(budget.closedReason)} ${text(budget.closedDimension)}`],
      ["Open allocations", text(budget.openAllocations)],
    ]);
  }
  if (research.works.length > 0) {
    const rows = research.works
      .map((work) => {
        const runs = work.runs
          .map(
            (run) =>
              `#${h(run.attempt)} ${h(run.path)} rounds ${text(run.rounds)}/${h(run.allocatedRounds)} searches ${text(run.searches)}/${h(run.allocatedSearches)} evidence ${text(run.evidenceItems)}${run.tools ? ` · tools ${toolCounts(run.tools)}` : ""}${run.childOutcome ? ` · child ${h(run.childOutcome)}, ${h(run.childEvidence)} evidence` : ""}${run.error ? ` · ${h(run.error)}` : ""}`,
          )
          .join("<br>");
        return `<tr><td>${h(work.workId)}</td><td>${h(work.kind)}</td><td>${h(work.branchId)}</td><td>${h(work.runner)}</td><td>${h(work.state)}</td><td>${text(work.terminalReason)}</td><td>${h(work.attempts)}</td><td>${h(work.findingChars)} chars · ${h(work.citationTokens)} cites${work.partial ? " · partial" : ""}</td><td>${runs}</td></tr>`;
      })
      .join("");
    const omitted =
      research.omittedWorks > 0 ? `<p>${h(research.omittedWorks)} more omitted</p>` : "";
    body += `${sub("Works")}<table class="data-table"><thead><tr><th>Work</th><th>Kind</th><th>Branch</th><th>Runner</th><th>State</th><th>Reason</th><th>Attempts</th><th>Finding</th><th>Runs</th></tr></thead><tbody>${rows}</tbody></table>${omitted}`;
  }
  if (research.hypotheses.length > 0) {
    body += `${sub("Hypotheses")}${dl(research.hypotheses.map((entry) => [entry.hypothesisId, h(entry.status)]))}`;
  }
  if (research.cycleDecisions.length > 0) {
    body += `${sub("Cycles")}${dl(research.cycleDecisions.map((cycle) => [`Cycle ${cycle.ordinal}`, `${h(cycle.decision)} · ${h(cycle.reason)}`]))}`;
  }
  if (research.tokensByStage && research.tokensByStage.length > 0) {
    const rows = research.tokensByStage
      .map(
        (entry) =>
          `<tr><td>${h(entry.stage)}</td><td>${h(entry.inputTokens)}</td><td>${h(entry.outputTokens)}</td></tr>`,
      )
      .join("");
    body += `${sub("Tokens by stage")}<table class="data-table"><thead><tr><th>Stage</th><th>Input</th><th>Output</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return collapsedCard("deep-research", "Deep Research", body);
}

function toolCounts(tools: Record<string, number>): string {
  return Object.entries(tools)
    .map(([name, count]) => `${h(name)} ${h(count)}`)
    .join(", ");
}
