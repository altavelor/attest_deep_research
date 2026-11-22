import type { ChatDisplayMessage } from "@core/conversation";
import type { ResearchReport, ResearchSectionView } from "@core/research/deepResearch";

/**
 * Returns the full report of a finished research by joining its history summary with the text of
 * the last assistant message that references it, or null when either cannot be found.
 */
export function finishedResearchReport(
  view: ResearchSectionView,
  messages: readonly ChatDisplayMessage[],
  researchId: string,
): ResearchReport | null {
  if (view.status !== "ready") return null;
  const summary = view.history.find((entry) => entry.researchId === researchId)?.report;
  const message = [...messages]
    .reverse()
    .find(
      (candidate) =>
        candidate.role === "assistant" && candidate.research?.researchId === researchId,
    );
  if (!summary || !message || message.content.trim() === "") return null;
  return { ...summary, markdown: message.content };
}
