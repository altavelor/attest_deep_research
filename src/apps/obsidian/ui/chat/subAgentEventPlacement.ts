import { placeSubAgentEvents, type SubAgentEventPlacement } from "@core/chat/subAgentPlacement";
import type { ChatDisplayMessage } from "@core/conversation";
import type { SubAgentDispatchEntry, SubAgentNoticeEntry } from "@core/research";

interface PlacementSource {
  messages: readonly ChatDisplayMessage[];
  subAgentDispatches?: readonly SubAgentDispatchEntry[];
  subAgentNotices?: readonly SubAgentNoticeEntry[];
}

const placements = new WeakMap<PlacementSource, SubAgentEventPlacement>();

/** Places the transcript's sub-agent events once per render options object. */
export function transcriptEventPlacement(source: PlacementSource): SubAgentEventPlacement {
  let placement = placements.get(source);
  if (!placement) {
    placement = placeSubAgentEvents(
      source.messages.filter((message) => message.kind !== "compact-summary"),
      source.subAgentDispatches ?? [],
      source.subAgentNotices ?? [],
    );
    placements.set(source, placement);
  }
  return placement;
}
