import type { ChainItem, ChatDisplayMessage } from "@core/conversation/model";

type ToolCallItem = Extract<ChainItem, { kind: "tool-call" }>;

/** True when a value is a usable shared timeline sequence: a nonnegative safe integer. */
export function isTimelineSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Drops every top-level tool-call sequence that is not a usable timeline sequence. */
export function sanitizeChainSequences(
  messages: readonly ChatDisplayMessage[],
): ChatDisplayMessage[] {
  return messages.map((message) => {
    const chain = message.researchProgress?.chain;
    if (!chain?.some(hasInvalidSequence)) return message;
    return {
      ...message,
      researchProgress: { ...message.researchProgress!, chain: chain.map(withoutInvalidSequence) },
    };
  });
}

/** Returns one above the highest tool-call sequence of every message chain, or zero. */
export function chainSequenceFloor(messages: readonly ChatDisplayMessage[]): number {
  let floor = 0;
  for (const message of messages) {
    for (const item of message.researchProgress?.chain ?? []) {
      if (item.kind === "tool-call" && isTimelineSequence(item.timelineSequence)) {
        floor = Math.max(floor, item.timelineSequence + 1);
      }
    }
  }
  return floor;
}

function hasInvalidSequence(item: ChainItem): boolean {
  return (
    item.kind === "tool-call" &&
    item.timelineSequence !== undefined &&
    !isTimelineSequence(item.timelineSequence)
  );
}

function withoutInvalidSequence(item: ChainItem): ChainItem {
  if (!hasInvalidSequence(item)) return item;
  const { timelineSequence: _timelineSequence, ...rest } = item as ToolCallItem;
  return rest;
}
