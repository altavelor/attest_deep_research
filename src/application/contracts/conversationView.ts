// UI boundary contract (SPEC R2). This names the seam between the platform-
// neutral core/application and ANY host UI (Obsidian view, CLI, web). The host
// never sees obsidian/DOM types — it issues a request and renders a stream of
// neutral events. The Obsidian implementation is apps/obsidian/ui; a different
// front-end is a new ConversationView over the same ConversationEngine, with no
// changes to core/application.

import type { ResearchRequest, ResearchStreamEvent } from "./research";

/** The neutral feed a host renders for one user turn. */
export type ConversationEvent = ResearchStreamEvent;

/** Command side: the host issues a question, receives a stream of events. */
export interface ConversationEngine {
  answer(request: ResearchRequest): AsyncIterable<ConversationEvent>;
}

/** Render side: what any host implements to present a conversation turn. */
export interface ConversationView {
  present(events: AsyncIterable<ConversationEvent>): Promise<void> | void;
}
