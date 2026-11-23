import { ASK_CLARIFICATION_TOOL, toolFailure } from "@core/agent";
import type { AnswerClarification } from "@core/answer";
import type { ResearchChatHistoryMessage } from "@core/research";
import {
  MAX_BRIEF_PROMPT_CHARS,
  MAX_BRIEF_SUGGESTION_CHARS,
  MAX_BRIEF_SUGGESTIONS,
  MAX_CLARIFICATION_QUESTIONS,
} from "@core/research/deepResearch";
import { parseClarificationArguments } from "@core/research";
import { defineTool, raw } from "@application/sources/tools";

export interface ClarificationRecorder {
  clarification?: AnswerClarification;
}

/** Ends a Thinking turn with clarifying questions; the user's reply arrives as the next message. */
export const AskClarificationTool = defineTool<
  ClarificationRecorder,
  AnswerClarification,
  { questionCount: number }
>({
  name: ASK_CLARIFICATION_TOOL,
  description:
    "Ask the user up to three clarifying questions and end this turn without an answer. Call it " +
    "only when the answer would change with information only the user has and that searching " +
    "cannot find.",
  schema: {
    questions: raw(
      {
        type: "array",
        minItems: 1,
        maxItems: MAX_CLARIFICATION_QUESTIONS,
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", maxLength: MAX_BRIEF_PROMPT_CHARS },
            suggestions: {
              type: "array",
              maxItems: MAX_BRIEF_SUGGESTIONS,
              items: { type: "string", maxLength: MAX_BRIEF_SUGGESTION_CHARS },
            },
          },
          required: ["prompt"],
          additionalProperties: false,
        },
      },
      { required: true },
    ),
  },
  parse: (input) => {
    const parsed = parseClarificationArguments(input);
    return parsed.ok
      ? { ok: true, value: parsed.clarification }
      : toolFailure("invalid-clarification", parsed.message);
  },
  execute: async (recorder, clarification) => {
    recorder.clarification = clarification;
    return { ok: true, value: { questionCount: clarification.questions.length } };
  },
});

/** Offers clarification unless the previous assistant message already asked for it. */
export function clarificationAllowed(history: readonly ResearchChatHistoryMessage[] = []): boolean {
  const lastAssistant = [...history].reverse().find((message) => message.role === "assistant");
  return lastAssistant?.clarification !== true;
}
