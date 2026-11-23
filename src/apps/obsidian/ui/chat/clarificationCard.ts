import type { AnswerClarification } from "@core/answer";
import { ChatDisplayMessage } from "@core/conversation";
import { MAX_RESEARCH_TEXT_CHARS } from "@core/research/deepResearch";
import {
  clarificationAnswersFromReply,
  formatClarificationReply,
  type ClarificationReplyLabels,
} from "@core/research";
import type { Translate } from "@adapters/i18n";

export interface ClarificationCardContext {
  t: Translate;
  running: boolean;
  onReply(reply: string): void;
}

/** Builds the localized labels of the reply message the card sends and reads back. */
export function clarificationReplyLabels(t: Translate): ClarificationReplyLabels {
  return {
    heading: t("chat.clarification.reply.heading"),
    answer: t("chat.clarification.reply.answer"),
    unanswered: t("chat.clarification.unanswered"),
  };
}

/**
 * Renders the clarifying questions of a Thinking turn. While the message is the latest one and no
 * run is active, each question gets an answer field with suggestion chips and the card sends the
 * answers or asks to proceed without them; otherwise it shows the answers the next message gave.
 */
export function renderClarificationCard(
  containerEl: HTMLElement,
  message: ChatDisplayMessage,
  messages: readonly ChatDisplayMessage[],
  context: ClarificationCardContext,
): void {
  const clarification = message.answer?.clarification;
  if (!clarification) return;
  const { t } = context;
  const index = messages.indexOf(message);
  const interactive = !context.running && index >= 0 && index === messages.length - 1;
  const cardEl = containerEl.createDiv({ cls: "attest-research-card attest-clarification-card" });
  const briefEl = cardEl.createDiv({ cls: "attest-research-card__brief" });
  briefEl.createDiv({ cls: "attest-research-card__title", text: t("chat.clarification.title") });
  const labels = clarificationReplyLabels(t);
  const next = index >= 0 ? messages[index + 1] : undefined;
  const given =
    next?.role === "user" ? clarificationAnswersFromReply(clarification, next.content, labels) : {};
  const fields = new Map<string, HTMLTextAreaElement>();
  for (const question of clarification.questions) {
    const rowEl = briefEl.createDiv({ cls: "attest-research-card__question" });
    rowEl.createDiv({ cls: "attest-research-card__branch-title", text: question.prompt });
    if (!interactive) {
      rowEl.createDiv({
        cls: "attest-research-card__branch-notes",
        text: given[question.questionId] ?? labels.unanswered,
      });
      continue;
    }
    const field = rowEl.createEl("textarea", {
      cls: "attest-research-card__editor-task",
      attr: { maxlength: String(MAX_RESEARCH_TEXT_CHARS), "aria-label": question.prompt },
    });
    fields.set(question.questionId, field);
    const chipsEl = rowEl.createDiv({ cls: "attest-research-card__suggestions" });
    for (const suggestion of question.suggestions) {
      const chip = chipsEl.createEl("button", {
        cls: "attest-research-card__suggestion",
        text: suggestion,
      });
      chip.addEventListener("click", () => (field.value = suggestion));
    }
  }
  if (interactive) renderReplyActions(briefEl, clarification, fields, labels, context);
}

function renderReplyActions(
  parentEl: HTMLElement,
  clarification: AnswerClarification,
  fields: ReadonlyMap<string, HTMLTextAreaElement>,
  labels: ClarificationReplyLabels,
  context: ClarificationCardContext,
): void {
  const { t } = context;
  const actionsEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const buttons: HTMLButtonElement[] = [];
  const send = (reply: string): void => {
    for (const button of buttons) button.disabled = true;
    context.onReply(reply);
  };
  const add = (label: string, primary: boolean, onClick: () => void): void => {
    const button = actionsEl.createEl("button", {
      cls: `attest-research-card__action${primary ? " mod-cta" : ""}`,
      text: label,
    });
    button.addEventListener("click", onClick);
    buttons.push(button);
  };
  add(t("chat.clarification.skip"), false, () => send(t("chat.clarification.skipMessage")));
  add(t("chat.clarification.send"), true, () => {
    const answers = Object.fromEntries(
      [...fields].map(([questionId, field]) => [questionId, field.value] as const),
    );
    send(formatClarificationReply(clarification, answers, labels));
  });
}
