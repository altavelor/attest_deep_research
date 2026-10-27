import { CATALOGUE_TOOL_NAMES, describeUnavailableTool } from "@core/agent";
import type { MessageParams } from "@core/i18n";
import { stripPseudoToolCalls } from "@core/research";

export type AnswerTranslate = (key: string, params?: MessageParams) => string;

/**
 * Replaces pseudo tool-call markup in a tool-less answer with one notice line
 * naming the tool the model tried to call. The notice is localized when a
 * translator is supplied and falls back to the model-facing English text.
 */
export function cleanToollessAnswer(
  answerText: string,
  reason: "instant" | "no-tools",
  translate?: AnswerTranslate,
): string {
  const stripped = stripPseudoToolCalls(answerText, CATALOGUE_TOOL_NAMES);
  const tool = stripped.toolNames[0];
  if (tool === undefined) return answerText;
  const description = describeUnavailableTool(tool, { reason });
  const notice = translate
    ? translate(description.userMessageKey, description.params)
    : description.modelMessage;
  return stripped.text ? `${stripped.text}\n\n${notice}` : notice;
}
