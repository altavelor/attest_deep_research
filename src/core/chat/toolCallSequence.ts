import type { ChainItem } from "@core/conversation/model";
import { normalizeSubAgentTimeline, type SubAgentTimelineState } from "./subAgentTimeline";

/**
 * Gives each top-level tool call of the trailing assistant message that has no sequence
 * the next shared timeline sequence, after the timeline is normalized so the message
 * itself is sequenced first. Returns null when no tool call needs a sequence.
 */
export function stampToolCallSequences(state: SubAgentTimelineState): SubAgentTimelineState | null {
  const last = state.messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress?.chain.some(isUnstamped)) return null;
  const normalized = normalizeSubAgentTimeline(state);
  const message = normalized.messages.at(-1)!;
  const progress = message.researchProgress!;
  let next = normalized.timelineSequence;
  const chain = progress.chain.map((item) =>
    isUnstamped(item) ? { ...item, timelineSequence: next++ } : item,
  );
  return {
    ...normalized,
    messages: [
      ...normalized.messages.slice(0, -1),
      { ...message, researchProgress: { ...progress, chain } },
    ],
    timelineSequence: next,
  };
}

function isUnstamped(item: ChainItem): boolean {
  return item.kind === "tool-call" && item.timelineSequence === undefined;
}
