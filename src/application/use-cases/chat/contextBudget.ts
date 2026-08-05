import { RetrievedChunk } from "@core/model";
import { estimateTextTokens, ResearchChatHistoryMessage } from "@core/research";

const DEFAULT_EXPLICIT_CONTEXT_WINDOW_SHARE = 0.45;
const FALLBACK_TOKENS_PER_EVIDENCE_ITEM = 500;

export interface ContextBudget {
  explicitTokens: number;
}

export function createContextBudget(input: {
  evidenceLimit: number;
  contextLimitTokens?: number;
  reservedOutputTokens?: number;
  chatHistory?: ResearchChatHistoryMessage[];
}): ContextBudget {
  if (!input.contextLimitTokens) {
    const fallback = Math.max(1, input.evidenceLimit) * FALLBACK_TOKENS_PER_EVIDENCE_ITEM;
    return { explicitTokens: fallback };
  }
  const historyTokens = estimateHistoryTokens(input.chatHistory ?? []);
  const available = Math.max(
    0,
    input.contextLimitTokens - (input.reservedOutputTokens ?? 0) - historyTokens,
  );
  return {
    explicitTokens: Math.max(0, Math.floor(available * DEFAULT_EXPLICIT_CONTEXT_WINDOW_SHARE)),
  };
}

export function packChunksByBudget<T extends RetrievedChunk>(
  chunks: T[],
  budgetTokens: number,
): T[] {
  const packed: T[] = [];
  let usedTokens = 0;
  for (const chunk of chunks) {
    const tokens = estimateTextTokens(chunk.text);
    if (usedTokens + tokens > budgetTokens) continue;
    packed.push(chunk);
    usedTokens += tokens;
  }
  return packed;
}

export function estimateChunksTokens(chunks: Array<{ text: string }>): number {
  return chunks.reduce((total, chunk) => total + estimateTextTokens(chunk.text), 0);
}

export function estimateHistoryTokens(history: ResearchChatHistoryMessage[]): number {
  return history.reduce((total, message) => total + estimateTextTokens(message.content), 0);
}
