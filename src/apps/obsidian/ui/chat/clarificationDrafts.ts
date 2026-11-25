import type { ChatDisplayMessage } from "@core/conversation";

export interface ClarificationDraft {
  answers: Record<string, string>;
  pending: boolean;
  error: string;
  renders: number;
}

/**
 * Keeps the submission state of clarification cards outside the DOM, keyed by the asking message,
 * so a transcript re-render restores the typed answers, the pending state, and a refusal reason.
 */
export class ClarificationDrafts {
  private readonly drafts = new Map<string, ClarificationDraft>();

  of(message: ChatDisplayMessage): ClarificationDraft {
    const key = message.id ?? message.createdAt;
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = { answers: {}, pending: false, error: "", renders: 0 };
      this.drafts.set(key, draft);
    }
    return draft;
  }

  discard(message: ChatDisplayMessage): void {
    this.drafts.delete(message.id ?? message.createdAt);
  }
}
