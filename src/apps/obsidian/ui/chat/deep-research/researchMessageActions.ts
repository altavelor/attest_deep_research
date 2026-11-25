import type { ChatDisplayMessage } from "@core/conversation";
import type { ResearchCardContext } from "./researchCardContext";

/**
 * Tells whether a message is an intermediate step of a Deep Research run and so gets no header
 * actions: a user message sent by a research card, or a research turn of the assistant other than
 * the latest turn of a finished research with a report. A running research has no history entry
 * yet, so all of its turns are intermediate.
 */
export function isIntermediateResearchMessage(
  message: ChatDisplayMessage,
  context: ResearchCardContext | undefined,
): boolean {
  if (message.role === "user") return message.researchTurn === true;
  const reference: unknown = message.research;
  if (typeof reference !== "object" || reference === null) return false;
  const { researchId, revision } = reference as { researchId?: unknown; revision?: unknown };
  if (typeof researchId !== "string" || context?.view.status !== "ready") return true;
  const latest = context.latestRevisions?.get(researchId);
  if (latest !== undefined && typeof revision === "number" && latest > revision) return true;
  return !context.view.history.find((entry) => entry.researchId === researchId)?.report;
}
