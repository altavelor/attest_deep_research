import type { ResearchStatePort } from "@application/ports/researchState";
import {
  applyDecision,
  deepResearchRejected,
  fitResearchSection,
  nextResearchSection,
  validateResearchSection,
  type PlanBranchEdit,
  type ResearchSectionView,
  type ResearchState,
} from "@core/research/deepResearch";
import type { ChatDisplayMessage } from "@core/conversation";
import { researchSectionView } from "@core/chat/savedChat";
import type { ChatSessionState } from "./chatSessionTypes";

export interface ChatResearchStateOptions {
  state: ChatSessionState;
  persist(): Promise<void>;
  persistLater(): void;
}

export interface ResearchPlanEditRequest {
  researchId: string;
  decisionId: string;
  expectedRevision: number;
  branches: readonly PlanBranchEdit[];
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

  commit(next: ResearchState, expectedRevision: number | null): Promise<void> {
    return this.commitWith(next, expectedRevision, this.options.state.messages);
  }

  /**
   * Commits a manual edit of the pending plan as a new plan revision without a chat turn. The edit
   * passes the same stale-decision and plan validation as an edit decision, and the latest card
   * reference of the edited revision moves to the new revision in the same save.
   */
  async editPlan(
    request: ResearchPlanEditRequest,
    context: { now: string; nextDecisionId: string },
  ): Promise<void> {
    const view = this.read();
    const current = view.status === "ready" ? view.active : null;
    const transition = current
      ? applyDecision(
          current,
          {
            researchId: request.researchId,
            decisionId: request.decisionId,
            expectedRevision: request.expectedRevision,
            payload: { action: "edit", edit: { branches: request.branches } },
          },
          context,
        )
      : null;
    if (!current || !transition) {
      throw deepResearchRejected(
        "research-stale-decision",
        "This decision no longer matches the research; review the current plan.",
      );
    }
    if (!transition.ok) throw deepResearchRejected(transition.code, transition.message);
    await this.commitWith(
      transition.state,
      current.revision,
      advanceReference(this.options.state.messages, current, transition.state.revision),
    );
  }

  private async commitWith(
    next: ResearchState,
    expectedRevision: number | null,
    messages: ChatDisplayMessage[],
  ): Promise<void> {
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
    const section = fitResearchSection(
      nextResearchSection(previous?.status === "ready" ? previous.section : null, next),
    );
    if (!section) {
      throw deepResearchRejected(
        "research-section-too-large",
        "The research state is larger than 1 MB and was not saved.",
      );
    }
    const validation = validateResearchSection(section);
    if (!validation.ok) throw deepResearchRejected("research-invalid-plan", validation.message);
    const previousMessages = this.options.state.messages;
    this.options.state.deepResearch = { status: "ready", section };
    this.options.state.messages = messages;
    try {
      await this.options.persist();
    } catch (error) {
      this.options.state.deepResearch = previous;
      this.options.state.messages = previousMessages;
      this.options.persistLater();
      throw error;
    }
  }
}

function advanceReference(
  messages: ChatDisplayMessage[],
  state: ResearchState,
  revision: number,
): ChatDisplayMessage[] {
  const index = messages
    .map((message) => message.research)
    .map(
      (research) =>
        research?.researchId === state.researchId && research.revision === state.revision,
    )
    .lastIndexOf(true);
  if (index < 0) return messages;
  return messages.map((message, at) =>
    at === index && message.research
      ? { ...message, research: { ...message.research, revision } }
      : message,
  );
}
