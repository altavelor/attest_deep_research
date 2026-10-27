import { stampChainSequences } from "@core/chat/chainItemSequence";
import { answerMessageId } from "@core/conversation";
import type { ChatSessionState } from "./chatSessionTypes";

/** Stamps the new chain items of the run's own answer message with shared timeline sequences. */
export function stampRunChain(state: ChatSessionState, runId: string): void {
  const stamped = stampChainSequences(state, answerMessageId(runId));
  if (!stamped) return;
  state.messages = stamped.messages;
  state.subAgentDispatches = stamped.subAgentDispatches;
  state.subAgentNotices = stamped.subAgentNotices;
  state.timelineSequence = stamped.timelineSequence;
}
