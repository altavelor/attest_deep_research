import type { ResearchStatePort } from "@application/ports/researchState";
import {
  MAX_RESEARCH_SECTION_BYTES,
  deepResearchRejected,
  nextResearchSection,
  validateResearchSection,
  type ResearchSectionView,
  type ResearchState,
} from "@core/research/deepResearch";
import { researchSectionView } from "@core/chat/savedChat";
import type { ChatSessionState } from "./chatSessionTypes";

export interface ChatResearchStateOptions {
  state: ChatSessionState;
  persist(): Promise<void>;
  persistLater(): void;
}

/**
 * The research state port of one chat: it reads the Deep Research section of the live session
 * and commits a next state as a barrier save through the chat's single writer. A commit checks
 * the expected revision, validates the section and its size, and leaves the session unchanged
 * when the save fails.
 */
export class ChatResearchState implements ResearchStatePort {
  constructor(private readonly options: ChatResearchStateOptions) {}

  read(): ResearchSectionView {
    return researchSectionView(this.options.state.deepResearch);
  }

  async commit(next: ResearchState, expectedRevision: number | null): Promise<void> {
    const view = this.read();
    if (view.status === "unreadable") {
      throw deepResearchRejected(
        "research-state-unreadable",
        `The saved research state of this chat is unreadable: ${view.reason}`,
      );
    }
    const current = view.active;
    if (
      (current?.revision ?? null) !== expectedRevision ||
      (current !== null && current.researchId !== next.researchId) ||
      next.revision !== (expectedRevision ?? 0) + 1
    ) {
      throw deepResearchRejected(
        "research-revision-conflict",
        "The research changed since it was read; review it again.",
      );
    }
    const previous = this.options.state.deepResearch;
    const section = nextResearchSection(
      previous?.status === "ready" ? previous.section : null,
      next,
    );
    if (new TextEncoder().encode(JSON.stringify(section)).length > MAX_RESEARCH_SECTION_BYTES) {
      throw deepResearchRejected(
        "research-section-too-large",
        "The research state is larger than 1 MB and was not saved.",
      );
    }
    const validation = validateResearchSection(section);
    if (!validation.ok) throw deepResearchRejected("research-invalid-plan", validation.message);
    this.options.state.deepResearch = { status: "ready", section };
    try {
      await this.options.persist();
    } catch (error) {
      this.options.state.deepResearch = previous;
      this.options.persistLater();
      throw error;
    }
  }
}
