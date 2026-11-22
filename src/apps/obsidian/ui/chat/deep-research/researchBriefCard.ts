import {
  MAX_RESEARCH_TEXT_CHARS,
  type ResearchBrief,
  type ResearchState,
  type ResearchTurnInput,
} from "@core/research/deepResearch";
import type { ResearchCardContext } from "./researchCardContext";
import { cancelAction, renderActions } from "./researchCardActions";

/**
 * Renders the research brief: the clarifying questions with their answers and the assumptions the
 * plan relies on. While its clarification is pending and no turn runs, each question gets an answer
 * field with suggestion chips, and the card sends the answers or continues with the assumptions.
 */
export function renderBrief(
  cardEl: HTMLElement,
  state: ResearchState,
  brief: ResearchBrief,
  context: ResearchCardContext,
): void {
  const { t } = context;
  const pending = state.pending?.kind === "clarification" && !context.running;
  if (brief.questions.length === 0 && brief.assumptions.length === 0) return;
  const briefEl = cardEl.createDiv({ cls: "attest-research-card__brief" });
  briefEl.createDiv({
    cls: "attest-research-card__title",
    text: t("chat.deepResearch.brief.title"),
  });
  const fields = new Map<string, HTMLTextAreaElement>();
  for (const question of brief.questions) {
    const rowEl = briefEl.createDiv({ cls: "attest-research-card__question" });
    rowEl.createDiv({ cls: "attest-research-card__branch-title", text: question.prompt });
    const answer = brief.answers[question.questionId];
    if (!pending) {
      rowEl.createDiv({
        cls: "attest-research-card__branch-notes",
        text: answer ?? t("chat.deepResearch.brief.unanswered"),
      });
      continue;
    }
    const field = rowEl.createEl("textarea", {
      cls: "attest-research-card__editor-task",
      attr: { maxlength: String(MAX_RESEARCH_TEXT_CHARS) },
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
  if (brief.assumptions.length > 0) {
    briefEl.createDiv({
      cls: "attest-research-card__meta",
      text: t("chat.deepResearch.brief.assumptions", { items: brief.assumptions.join("; ") }),
    });
  }
  if (!pending) return;
  const decide = (payload: unknown): ResearchTurnInput => ({
    type: "decision",
    decision: {
      researchId: state.researchId,
      decisionId: state.pending!.decisionId,
      expectedRevision: state.revision,
      payload,
    },
  });
  renderActions(
    briefEl,
    state,
    context,
    [
      {
        label: t("chat.deepResearch.action.assume"),
        turnLabel: t("chat.deepResearch.turn.assume"),
        input: decide({ action: "assume" }),
      },
      cancelAction(state, t),
    ],
    () => {
      const answers = Object.fromEntries(
        [...fields]
          .map(([questionId, field]) => [questionId, field.value.trim()] as const)
          .filter(([, value]) => value !== ""),
      );
      return {
        label: t("chat.deepResearch.action.answer"),
        turnLabel: t("chat.deepResearch.turn.answer"),
        input: decide(
          Object.keys(answers).length > 0 ? { action: "answer", answers } : { action: "assume" },
        ),
        primary: true,
      };
    },
  );
}
