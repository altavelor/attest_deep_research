import { RetrievedChunk } from "@core/model/source";

// Short, copy-friendly citation labels. Evidence ids are content hashes
// (`stableId(...)`) or `web:<hash>` — long, opaque tokens the model must
// reproduce verbatim to cite, which invites typos and hallucinated ids. Instead
// the prompt presents each evidence item as `[S1]`, `[S2]`, … and the answer is
// rewritten back to the real ids afterwards, so the whole downstream contract
// (UI inline anchors, saved-note formatter) still sees raw `[chunk-id]` tokens.

export const CITATION_LABEL_PREFIX = "S";

const LABEL_TOKEN = new RegExp(`^${CITATION_LABEL_PREFIX}\\d+$`, "i");
const BRACKET_TOKEN = /\[([^\]\n]{1,200})\]/g;

export interface LabeledChunk {
  label: string;
  chunk: RetrievedChunk;
}

export interface LabeledResearchEvidence {
  explicit: LabeledChunk[];
  graph: LabeledChunk[];
  retrieved: LabeledChunk[];
  web: LabeledChunk[];
  /** Uppercased label (e.g. "S1") → cited chunk id. */
  byLabel: Map<string, string>;
}

/** The evidence sections buildResearchPrompt renders, plus the item cap. */
export interface EvidenceSectionsInput {
  evidence: RetrievedChunk[];
  explicitEvidence?: RetrievedChunk[];
  graphEvidence?: RetrievedChunk[];
  retrievedEvidence?: RetrievedChunk[];
  webEvidence?: RetrievedChunk[];
  maxEvidenceItems: number;
}

/**
 * Assign sequential `S1…Sn` labels to the evidence in the exact order and with
 * the exact slicing buildResearchPrompt uses, so a caller can recompute the
 * mapping deterministically from the same options and rewrite the answer.
 */
export function labelResearchEvidence(input: EvidenceSectionsInput): LabeledResearchEvidence {
  const byLabel = new Map<string, string>();
  const seen = new Set<string>();
  let counter = 0;

  const assign = (chunks: RetrievedChunk[]): LabeledChunk[] => {
    const labeled: LabeledChunk[] = [];
    for (const chunk of chunks) {
      if (labeled.length >= input.maxEvidenceItems) {
        break;
      }
      if (seen.has(chunk.id)) {
        continue;
      }
      seen.add(chunk.id);
      counter += 1;
      const label = `${CITATION_LABEL_PREFIX}${counter}`;
      byLabel.set(label.toUpperCase(), chunk.id);
      labeled.push({ label, chunk });
    }
    return labeled;
  };

  return {
    explicit: assign(input.explicitEvidence ?? []),
    graph: assign(input.graphEvidence ?? []),
    retrieved: assign(input.retrievedEvidence ?? input.evidence),
    web: assign(input.webEvidence ?? []),
    byLabel,
  };
}

export interface CitationRewriteResult {
  /** Answer text with `[S1]` labels expanded to their real `[chunk-id]` tokens. */
  text: string;
  /** Chunk ids the answer actually cites (via a known label). */
  citedChunkIds: Set<string>;
  /** Labels the model emitted that map to no evidence — dropped from the text. */
  unknownLabels: string[];
}

/**
 * Rewrite `[S1]`-style citation labels back to the real evidence ids. Brackets
 * that are not label tokens (raw ids, markdown link text, prose) are left
 * untouched. A bracket may group labels (`[S1, S2]`) — expanded to `[id1][id2]`.
 */
export function rewriteCitationLabels(
  text: string,
  byLabel: ReadonlyMap<string, string>,
): CitationRewriteResult {
  const citedChunkIds = new Set<string>();
  const unknownLabels = new Set<string>();

  const rewritten = text.replace(BRACKET_TOKEN, (whole, inner: string) => {
    const tokens = inner
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    if (tokens.length === 0 || !tokens.every((token) => LABEL_TOKEN.test(token))) {
      return whole;
    }

    const ids: string[] = [];
    for (const token of tokens) {
      const id = byLabel.get(token.toUpperCase());
      if (id) {
        citedChunkIds.add(id);
        ids.push(id);
      } else {
        unknownLabels.add(token.toUpperCase());
      }
    }

    return ids.map((id) => `[${id}]`).join("");
  });

  return { text: rewritten, citedChunkIds, unknownLabels: [...unknownLabels] };
}
