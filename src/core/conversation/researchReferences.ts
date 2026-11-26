import type { ChatDisplayMessage } from "./model";

/** Maps each research a message refers to onto the highest revision any message refers to. */
export function latestResearchRevisions(
  messages: readonly ChatDisplayMessage[],
): ReadonlyMap<string, number> {
  const latest = new Map<string, number>();
  for (const { research } of messages) {
    if (!research) continue;
    latest.set(
      research.researchId,
      Math.max(latest.get(research.researchId) ?? 0, research.revision),
    );
  }
  return latest;
}
