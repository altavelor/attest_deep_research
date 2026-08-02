import { RetrievedChunk } from "@core/model/source";

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

  byLabel: Map<string, string>;
}

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
  text: string;

  citedChunkIds: Set<string>;

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
