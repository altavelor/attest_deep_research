export interface SubAgentDirective {
  forceSubAgent: boolean;
  cleanedQuestion: string;
}

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
