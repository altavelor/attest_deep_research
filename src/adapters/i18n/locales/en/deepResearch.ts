export const deepResearch = {
  "chat.composer.researchMode.deepResearch": "Deep Research",
  "chat.deepResearch.card.title": "Research plan",
  "chat.deepResearch.card.meta": "Revision {revision} · generation {used} of {max}",
  "chat.deepResearch.card.optional": "Optional",
  "chat.deepResearch.card.dependsOn": "After: {branches}",
  "chat.deepResearch.card.omissions": "Known omissions: {items}",
  "chat.deepResearch.action.approve": "Approve",
  "chat.deepResearch.action.edit": "Edit",
  "chat.deepResearch.action.save": "Save changes",
  "chat.deepResearch.action.regenerate": "Regenerate",
  "chat.deepResearch.action.cancel": "Cancel research",
  "chat.deepResearch.superseded": "An older revision of this plan; see the latest card.",
  "chat.deepResearch.approved": "Plan approved.",
  "chat.deepResearch.ended": "This research has ended.",
  "chat.deepResearch.unreadable": "The research state of this chat is unreadable: {reason}",
  "chat.deepResearch.turn.approve": "Approve the research plan",
  "chat.deepResearch.turn.edit": "Edit the research plan",
  "chat.deepResearch.turn.regenerate": "Regenerate the research plan",
  "chat.deepResearch.turn.cancel": "Cancel the research",
  "chat.history.requiresAction": "Waiting for your decision",
};

export type EnDeepResearchMessages = Record<keyof typeof deepResearch, string>;
