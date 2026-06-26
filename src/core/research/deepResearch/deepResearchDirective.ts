// Parses an explicit `@deep_search` directive out of a chat question. The mention
// is a user-facing way to *force* the deep-research sub-agent for a turn; the
// token itself is stripped from the question the model actually sees.

export interface DeepResearchDirective {
  forceDeepSearch: boolean;
  cleanedQuestion: string;
}

// `@deep_search` as a standalone token (surrounded by start/space/punctuation),
// case-insensitive. Underscores are part of the token so we anchor on a boundary
// that is not a word char or `_`.
const DEEP_SEARCH_MENTION = /(^|[^\w])@deep_search\b/gi;

export const DEEP_SEARCH_MENTION_INSERT = "deep_search";

export function parseDeepResearchDirective(question: string): DeepResearchDirective {
  const forceDeepSearch = DEEP_SEARCH_MENTION.test(question);
  DEEP_SEARCH_MENTION.lastIndex = 0;

  if (!forceDeepSearch) {
    return { forceDeepSearch: false, cleanedQuestion: question };
  }

  const cleanedQuestion = question
    .replace(DEEP_SEARCH_MENTION, (_match, prefix: string) => prefix)
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  DEEP_SEARCH_MENTION.lastIndex = 0;

  return { forceDeepSearch: true, cleanedQuestion };
}
