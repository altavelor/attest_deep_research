import type { Translate } from "@adapters/i18n";
import type { SubAgentRunAnswer } from "@application/contracts/subAgentInspection";

/** Short header summary of the selected run's final answer. */
export function answerSummary(
  answer: SubAgentRunAnswer | undefined,
  runNumber: number,
  t: Translate,
): string {
  return t("chat.subAgents.answer.summary", { run: runNumber, chars: answer?.text.length ?? 0 });
}

/** Renders the redacted final answer of a run as plain text, or says that the run has none. */
export function renderAnswerBody(
  bodyEl: HTMLElement,
  answer: SubAgentRunAnswer | undefined,
  t: Translate,
): void {
  if (!answer) {
    bodyEl.createDiv({
      cls: "attest-sub-agents__prompt-state",
      text: t("chat.subAgents.answer.empty"),
    });
    return;
  }
  bodyEl.createEl("pre", {
    cls: "attest-sub-agents__prompt-content",
    attr: { dir: "auto" },
  }).textContent = answer.text;
  if (answer.truncated) {
    bodyEl.createDiv({
      cls: "attest-sub-agents__prompt-truncated",
      text: t("chat.subAgents.answer.truncated"),
    });
  }
}
