import { chatHistoryForPrompt } from "@application/use-cases/chat";
import { estimateResearchRequestTokens } from "@core/research";
import { ChatDisplayMessage } from "@core/conversation";

export interface ContextWindowUsage {
  estimatedTokens: number;
  limitTokens: number;
}

/** Estimates the current composer request against the selected model context window. */
export function contextWindowUsage(options: {
  question: string;
  messages: ChatDisplayMessage[];
  limitTokens: number | undefined;
  reservedOutputTokens: number | undefined;
}): ContextWindowUsage | null {
  if (!options.limitTokens) return null;

  return {
    estimatedTokens: estimateResearchRequestTokens({
      question: options.question,
      chatHistory: chatHistoryForPrompt(options.messages),
      evidence: [],
      maxEvidenceItems: 0,
      reservedOutputTokens: options.reservedOutputTokens,
    }),
    limitTokens: options.limitTokens,
  };
}
