import type {
  SubAgentInspectionPort,
  SubAgentMainEventIntent,
  SubAgentMainEventSink,
} from "@application/ports/subAgent";
import { applySubAgentTimelineEvent } from "@core/chat/subAgentTimeline";
import type { ChatSessionState } from "./chatSessionTypes";

export interface ChatSubAgentBridgeContext {
  state: ChatSessionState;
  ownsParentRun(parentRunId: string): boolean;
  inspection(): SubAgentInspectionPort | null;
  onTimelineChanged(): void;
}

/**
 * The chat-owned sink of main-visible sub-agent dispatches and notices. It gives each
 * new event the next sequence of the parent timeline shared with messages, keeps one
 * entry per event key, accepts only events of this chat's own parent runs and forwards
 * inspection of the chat's child sessions without exposing the manager.
 */
export class ChatSubAgentBridge implements SubAgentMainEventSink {
  private disposed = false;

  constructor(private readonly context: ChatSubAgentBridgeContext) {}

  publish(intents: readonly SubAgentMainEventIntent[]): void {
    if (this.disposed) return;
    const { state } = this.context;
    let changed = false;
    for (const intent of intents) {
      if (!this.context.ownsParentRun(intent.entry.parentRunId)) continue;
      const next = applySubAgentTimelineEvent(state, intent);
      if (!next) continue;
      state.messages = next.messages;
      state.subAgentDispatches = next.subAgentDispatches;
      state.subAgentNotices = next.subAgentNotices;
      state.timelineSequence = next.timelineSequence;
      changed = true;
    }
    if (changed) this.context.onTimelineChanged();
  }

  inspection(): SubAgentInspectionPort | null {
    return this.disposed ? null : this.context.inspection();
  }

  dispose(): void {
    this.disposed = true;
  }
}
