import type { Translate } from "@adapters/i18n";
import type { SubAgentInitialPrompt } from "@core/research";

/** Short header summary of the selected run's initial prompt. */
export function promptSummary(
  prompt: SubAgentInitialPrompt | undefined,
  runNumber: number,
  t: Translate,
): string {
  const parts = [
    t("chat.subAgents.prompt.summary", {
      run: runNumber,
      count: prompt?.state === "captured" ? prompt.messages.length : 0,
    }),
  ];
  if (prompt?.redacted) parts.push(t("chat.subAgents.prompt.redacted"));
  return parts.join(" · ");
}

/**
 * Renders the redacted initial prompt as plain text with its role labels and markers.
 * A run without a captured prompt gets an explicit explanation instead of an empty field.
 */
export function renderPromptBody(
  bodyEl: HTMLElement,
  prompt: SubAgentInitialPrompt | undefined,
  t: Translate,
): void {
  if (!prompt || prompt.state !== "captured") {
    const state = prompt?.state ?? "unavailable";
    bodyEl.createDiv({
      cls: "attest-sub-agents__prompt-state",
      text: t(`chat.subAgents.prompt.${state}`),
    });
    return;
  }
  const listEl = bodyEl.createDiv({ cls: "attest-sub-agents__prompt" });
  for (const message of prompt.messages) {
    const rowEl = listEl.createDiv({ cls: "attest-sub-agents__prompt-message" });
    rowEl.createDiv({
      cls: "attest-sub-agents__prompt-role",
      text: t(`chat.subAgents.role.${message.role}`),
    });
    rowEl.createEl("pre", { cls: "attest-sub-agents__prompt-content" }).textContent =
      message.content;
  }
  if (prompt.redacted) {
    listEl.createSpan({
      cls: "attest-sub-agents__prompt-redacted",
      text: t("chat.subAgents.prompt.redacted"),
    });
  }
  if (prompt.truncated) {
    listEl.createDiv({
      cls: "attest-sub-agents__prompt-truncated",
      text: t("chat.subAgents.prompt.truncated"),
    });
  }
}
