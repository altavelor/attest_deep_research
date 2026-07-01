// Parses an explicit `@run_subagent` directive out of a chat question. The mention
// is a user-facing way to *force* the universal sub-agent for a turn; the token
// itself is stripped from the question the model actually sees.

export interface SubAgentDirective {
  forceSubAgent: boolean;
  cleanedQuestion: string;
}

// `@run_subagent` as a standalone token (surrounded by start/space/punctuation),
// case-insensitive. Underscores are part of the token so we anchor on a boundary
// that is not a word char or `_`.
const SUB_AGENT_MENTION = /(^|[^\w])@run_subagent\b/gi;

export const SUB_AGENT_MENTION_INSERT = "run_subagent";

export function parseSubAgentDirective(question: string): SubAgentDirective {
  const forceSubAgent = SUB_AGENT_MENTION.test(question);
  SUB_AGENT_MENTION.lastIndex = 0;

  if (!forceSubAgent) {
    return { forceSubAgent: false, cleanedQuestion: question };
  }

  const cleanedQuestion = question
    .replace(SUB_AGENT_MENTION, (_match, prefix: string) => prefix)
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  SUB_AGENT_MENTION.lastIndex = 0;

  return { forceSubAgent: true, cleanedQuestion };
}
