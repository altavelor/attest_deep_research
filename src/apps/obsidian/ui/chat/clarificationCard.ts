import type { AnswerClarification, ClarificationReply } from "@core/answer";
import { ChatDisplayMessage } from "@core/conversation";
import { MAX_RESEARCH_TEXT_CHARS } from "@core/research/deepResearch";
import {
  clarificationReplyOf,
  formatClarificationReply,
  type ClarificationReplyLabels,
} from "@core/research";
import type { Translate } from "@adapters/i18n";
import type { ClarificationDraft, ClarificationDrafts } from "./clarificationDrafts";

export type ClarificationReplyOutcome =
  { started: true } | { started: false; reason: string | null };

export interface ClarificationCardContext {
  t: Translate;
  running: boolean;
  drafts: ClarificationDrafts;
  requestRedisplay(): void;
  onReply(text: string, reply: ClarificationReply): Promise<ClarificationReplyOutcome>;
}

/** Builds the localized labels of the reply message text the card sends to the model. */
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
 * Service notices such as the automatic compaction line are not conversation messages here.
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
  const conversation = messages.filter((item) => item.kind !== "notice");
  const index = conversation.indexOf(message);
  const interactive = !context.running && index >= 0 && index === conversation.length - 1;
  const cardEl = containerEl.createDiv({ cls: "attest-research-card attest-clarification-card" });
  const briefEl = cardEl.createDiv({ cls: "attest-research-card__brief" });
  briefEl.createDiv({ cls: "attest-research-card__title", text: t("chat.clarification.title") });
  const labels = clarificationReplyLabels(t);
  const next = index >= 0 ? conversation[index + 1] : undefined;
  const given = next?.role === "user" ? (next.clarificationReply?.answers ?? {}) : {};
  const draft = context.drafts.of(message);
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
    field.value = draft.answers[question.questionId] ?? "";
    field.addEventListener("input", () => (draft.answers[question.questionId] = field.value));
    fields.set(question.questionId, field);
    const chipsEl = rowEl.createDiv({ cls: "attest-research-card__suggestions" });
    for (const suggestion of question.suggestions) {
      const chip = chipsEl.createEl("button", {
        cls: "attest-research-card__suggestion",
        text: suggestion,
      });
      chip.addEventListener("click", () => {
        field.value = suggestion;
        draft.answers[question.questionId] = suggestion;
      });
    }
  }
  if (interactive) {
    renderReplyActions(briefEl, { message, clarification, draft, fields, labels }, context);
  }
}

interface ReplyForm {
  message: ChatDisplayMessage;
  clarification: AnswerClarification;
  draft: ClarificationDraft;
  fields: ReadonlyMap<string, HTMLTextAreaElement>;
  labels: ClarificationReplyLabels;
}

function renderReplyActions(
  parentEl: HTMLElement,
  form: ReplyForm,
  context: ClarificationCardContext,
): void {
  const { t } = context;
  const { message, clarification, draft, fields, labels } = form;
  draft.renders += 1;
  const generation = draft.renders;
  const actionsEl = parentEl.createDiv({ cls: "attest-research-card__actions" });
  const buttons: HTMLButtonElement[] = [];
  const errorEl = parentEl.createDiv({
    cls: "attest-research-card__branch-notes attest-clarification-card__error",
    attr: { role: "alert" },
    text: draft.error,
  });
  const settle = (error: string): void => {
    draft.pending = false;
    draft.error = error;
    if (draft.renders !== generation) {
      context.requestRedisplay();
      return;
    }
    for (const button of buttons) button.disabled = false;
    errorEl.setText(error);
  };
  const send = (text: string, reply: ClarificationReply): void => {
    draft.pending = true;
    draft.error = "";
    for (const button of buttons) button.disabled = true;
    errorEl.setText("");
    void context.onReply(text, reply).then(
      (outcome) => {
        if (outcome.started) {
          context.drafts.discard(message);
          return;
        }
        settle(outcome.reason ?? "");
      },
      () => settle(""),
    );
  };
  const add = (label: string, primary: boolean, onClick: () => void): void => {
    const button = actionsEl.createEl("button", {
      cls: `attest-research-card__action${primary ? " mod-cta" : ""}`,
      text: label,
    });
    button.disabled = draft.pending;
    button.addEventListener("click", onClick);
    buttons.push(button);
  };
  add(t("chat.clarification.skip"), false, () =>
    send(t("chat.clarification.skipMessage"), { answers: {}, skipped: true }),
  );
  add(t("chat.clarification.send"), true, () => {
    const answers = Object.fromEntries(
      [...fields].map(([questionId, field]) => [questionId, field.value] as const),
    );
    const reply = clarificationReplyOf(clarification, answers);
    send(formatClarificationReply(clarification, reply, labels), reply);
  });
}
