import type { ResearchRequest, ResearchStreamEvent } from "./research";

export type ConversationEvent = ResearchStreamEvent;

export interface ConversationEngine {
  answer(request: ResearchRequest): AsyncIterable<ConversationEvent>;
}

export interface ConversationView {
  present(events: AsyncIterable<ConversationEvent>): Promise<void> | void;
}
