// Structured evidence produced by a deep-research sub-agent (pure domain types +
// formatting). The sub-agent synthesizes findings with a reliability grade and the
// supporting source evidence ids; the parent model reads the formatted report and
// cites the same ids. No I/O — JSON parsing of raw model output lives in the
// application layer (it needs the shared LLM-output helpers).

export type DeepResearchReliability = "high" | "medium" | "low";

export interface DeepResearchFinding {
  claim: string;
  reliability: DeepResearchReliability;
  /** Evidence ids that support this claim (registered sources). */
  sourceEvidenceIds: string[];
}

export interface DeepResearchReport {
  question: string;
  summary: string;
  findings: DeepResearchFinding[];
  contradictions: string[];
  uncertainties: string[];
}

/** A source the sub-agent gathered, as the parent model should see it. */
export interface DeepResearchReportSource {
  evidenceId: string;
  title: string;
  url: string;
}

export function isDeepResearchReliability(value: unknown): value is DeepResearchReliability {
  return value === "high" || value === "medium" || value === "low";
}

/**
 * Remap the evidence ids a sub-agent used internally to the ids the parent
 * evidence registry assigned, dropping any that did not survive re-registration.
 */
export function remapReportEvidenceIds(
  report: DeepResearchReport,
  idMap: ReadonlyMap<string, string>,
): DeepResearchReport {
  return {
    ...report,
    summary: remapInlineCitations(report.summary, idMap),
    findings: report.findings.map((finding) => ({
      ...finding,
      claim: remapInlineCitations(finding.claim, idMap),
      sourceEvidenceIds: finding.sourceEvidenceIds
        .map((id) => idMap.get(id))
        .filter((id): id is string => typeof id === "string"),
    })),
  };
}

/** Rewrite `[subId]` inline citations in prose to the parent registry ids. */
function remapInlineCitations(text: string, idMap: ReadonlyMap<string, string>): string {
  return text.replace(/\[([^\]]+)\]/g, (match, id: string) => {
    const mapped = idMap.get(id.trim());
    return mapped ? `[${mapped}]` : match;
  });
}

/** Compact text the parent model reads as the `deep_search` tool result. */
export function formatDeepResearchReport(
  report: DeepResearchReport,
  sources: readonly DeepResearchReportSource[],
): string {
  // Sources are filtered against the original evidence ids before we rewrite
  // citations, so build the id→URL map up front from the cited set.
  const citedSources = filterCitedSources(report, sources);
  const idToUrl = new Map(citedSources.map((source) => [source.evidenceId, source.url]));

  // The question is already echoed in the tool-result envelope and was supplied
  // by the parent in the call arguments — repeating it here only burns the
  // agentic tool-result budget. Lead with the synthesized, citable substance.
  const lines: string[] = [];
  if (report.summary.trim()) {
    lines.push("Summary:", rewriteCitesToUrls(report.summary.trim(), idToUrl));
  }

  if (report.findings.length > 0) {
    lines.push("", "Findings:");
    report.findings.forEach((finding, index) => {
      // Drop unresolved ids entirely: a finding cite is always an evidence id, and a raw
      // `web:<hash>` (or abbreviated id) leaking to the parent reintroduces the very handle
      // confusion the URL-citation scheme removes.
      const cites = finding.sourceEvidenceIds
        .map((id) => idToUrl.get(id))
        .filter((url): url is string => typeof url === "string")
        .map((url) => `[url:${url}]`)
        .join(" ");
      const claim = rewriteCitesToUrls(finding.claim, idToUrl);
      lines.push(`${index + 1}. (${finding.reliability}) ${claim}${cites ? ` ${cites}` : ""}`);
    });
  }

  if (report.contradictions.length > 0) {
    lines.push("", "Contradictions / conflicting sources:");
    for (const item of report.contradictions) lines.push(`- ${item}`);
  }

  if (report.uncertainties.length > 0) {
    lines.push("", "Open questions / uncertainty:");
    for (const item of report.uncertainties) lines.push(`- ${item}`);
  }

  // Sources last and trimmed to the ones actually cited above. Uncited gathered
  // pages are noise that bloats the parent's tool-result budget. Cite a source in
  // the final answer with `[url:<its URL>]` — not the bare URL, and never pass it
  // to fetch_web_page (these are citation handles, not fetchable results).
  if (citedSources.length > 0) {
    lines.push("", "Sources (cite by [url:<url>]):");
    for (const source of citedSources) {
      lines.push(`- ${source.title || source.url} — ${source.url}`);
    }
  }

  return lines.join("\n");
}

// An evidence-id-shaped citation token: a `web:<hash>` handle or a bare hex id (including
// the abbreviated ids sub-agents sometimes emit). These must never reach the parent raw;
// ordinary bracketed prose (e.g. "[note]") is left untouched.
const EVIDENCE_ID_TOKEN = /^(?:web:|[0-9a-f]{6,}$)/i;
// Wrapper prefixes models tack onto a citation handle, e.g. `[evidenceId:web:…]`, `[id:…]`.
// Stripped before lookup so the inner handle resolves (or is recognized as droppable).
const CITE_PREFIX = /^(?:evidence[-_]?id|id|cite|source)\s*:\s*/i;

function normalizeCiteId(raw: string): string {
  return raw.trim().replace(CITE_PREFIX, "").trim();
}

/** Rewrite inline `[evidenceId]` cites in prose to `[url:…]`. Unresolved evidence-id-shaped
 * tokens are dropped so no opaque handle leaks to the parent; non-citation brackets stay. */
function rewriteCitesToUrls(text: string, idToUrl: ReadonlyMap<string, string>): string {
  return text
    .replace(/\s*\[([^\]]+)\]/g, (match, raw: string) => {
      const trimmed = raw.trim();
      const id = normalizeCiteId(trimmed);
      const url = idToUrl.get(id) ?? idToUrl.get(trimmed);
      if (url) return ` [url:${url}]`;
      const isHandle = EVIDENCE_ID_TOKEN.test(id) || CITE_PREFIX.test(trimmed);
      return isHandle ? "" : match;
    })
    .trim();
}

/** The evidence ids referenced by the report's findings and inline prose cites. */
function collectCitedIds(report: DeepResearchReport): Set<string> {
  const ids = new Set<string>();
  const addInline = (text: string): void => {
    for (const match of text.matchAll(/\[([^\]]+)\]/g)) {
      const raw = match[1].trim();
      ids.add(raw);
      ids.add(normalizeCiteId(raw));
    }
  };
  addInline(report.summary);
  for (const finding of report.findings) {
    addInline(finding.claim);
    for (const id of finding.sourceEvidenceIds) ids.add(id);
  }
  return ids;
}

function filterCitedSources(
  report: DeepResearchReport,
  sources: readonly DeepResearchReportSource[],
): DeepResearchReportSource[] {
  const cited = collectCitedIds(report);
  return sources.filter((source) => cited.has(source.evidenceId));
}
