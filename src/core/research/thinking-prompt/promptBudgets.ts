import { estimateTextTokens } from "../prompts";

export type PromptProfileId =
  "index-only" | "vault-mutations" | "web-only" | "index-web-mutations-workflows";

/**
 * Ceilings for the static part of the system prompt, in tokens, per profile. Fixed from
 * the measured worst assembly of each profile — every workflow module in its full form —
 * plus a small margin. Delimited evidence, chat history and the index description are
 * measured separately and excluded. Raising a ceiling is a normative change.
 */
export const PROMPT_TOKEN_CEILINGS: Readonly<Record<PromptProfileId, number>> = Object.freeze({
  "index-only": 2_400,
  "vault-mutations": 2_300,
  "web-only": 2_350,
  "index-web-mutations-workflows": 4_200,
});

export interface PromptSizeMeasurement {
  characters: number;
  tokens: number;
}

export function measurePromptSize(text: string): PromptSizeMeasurement {
  return { characters: text.length, tokens: estimateTextTokens(text) };
}
