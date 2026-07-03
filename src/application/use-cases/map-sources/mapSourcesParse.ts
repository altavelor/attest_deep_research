// Per-source task template + tolerant parsing of a sub-agent's free-text answer
// into a structured stance row. Kept as pure functions so the reduce contract is
// unit-testable without running an agent (SPEC-corpus R5).

import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import { MAP_SOURCE_STANCES, MapSourceStance } from "./types";

const MAX_FINDINGS = 4;
const MAX_FINDING_CHARS = 400;
const MAX_EVIDENCE_IDS = 12;

/** Instruction handed to the sub-agent scoped to a single document. */
export function buildSourceTask(question: string, sourcePath: string): string {
  return [
    `You are analyzing ONE document to answer a corpus-wide question. The document's ` +
      `index path is "${sourcePath}".`,
    `Restrict every index call (search_index, read_index_section, read_index_chunk, ` +
      `list_index_urls) to this document by passing sourcePath: "${sourcePath}". Do not ` +
      `consult other documents or the web.`,
    ``,
    `Question: ${question}`,
    ``,
    `Read enough of the document to judge its position, then produce a final answer with:`,
    `- 1 to ${MAX_FINDINGS} key findings, each one sentence carrying an inline [evidenceId] ` +
      `citation from your index results.`,
    `- If the document does not address the question, say so plainly.`,
    `End with a single line exactly of the form:`,
    `STANCE: <SUPPORTS|OPPOSES|MIXED|NOT_ADDRESSED|UNCLEAR>`,
    `where the label describes how this document relates to the question.`,
  ].join("\n");
}

interface ParsedAnswer {
  stance: MapSourceStance;
  keyFindings: string[];
}

/** Extract stance + findings from the answer; both degrade gracefully when absent. */
export function parseSourceAnswer(answer: string): ParsedAnswer {
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let stance: MapSourceStance = "unclear";
  const findings: string[] = [];
  for (const line of lines) {
    const stanceMatch = /^stance:\s*([a-z_]+)/i.exec(line);
    if (stanceMatch) {
      stance = normalizeStance(stanceMatch[1]) ?? stance;
      continue;
    }
    if (findings.length < MAX_FINDINGS) {
      findings.push(stripBullet(line).slice(0, MAX_FINDING_CHARS));
    }
  }

  return { stance, keyFindings: findings };
}

/** Evidence ids the answer actually cites, falling back to the whole snapshot. */
export function citedEvidenceIds(answer: string, snapshot: ResearchEvidenceSnapshot): string[] {
  const available = snapshot.evidence.map((chunk) => chunk.id);
  const cited = available.filter((id) => answer.includes(id));
  const chosen = cited.length > 0 ? cited : available;
  return chosen.slice(0, MAX_EVIDENCE_IDS);
}

function normalizeStance(raw: string): MapSourceStance | undefined {
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return MAP_SOURCE_STANCES.find((stance) => stance === normalized);
}

function stripBullet(line: string): string {
  return line.replace(/^([-*•]|\d+[.)])\s+/, "");
}
