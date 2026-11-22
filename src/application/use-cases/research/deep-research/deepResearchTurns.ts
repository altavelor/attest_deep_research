import type { ResearchSearchMode } from "@core/research";
import {
  deepResearchRejected,
  type ResearchSourceScope,
  type ResearchState,
  type ResearchTurnInput,
} from "@core/research/deepResearch";

export interface ResearchSources {
  toolCalls: boolean;
  index: boolean;
  web: boolean;
}

/**
 * Resolves the turn a Deep Research message stands for. Explicit input wins; plain text starts
 * a research when none is active and is the regeneration instruction of a pending plan decision.
 */
export function resolveResearchTurn(
  input: ResearchTurnInput | undefined,
  active: ResearchState | null,
  text: string,
): ResearchTurnInput {
  if (input && (input.type !== "start" || active === null)) return input;
  if (active === null) return { type: "start" };
  if (!input && active.pending?.kind === "plan") {
    return {
      type: "decision",
      decision: {
        researchId: active.researchId,
        decisionId: active.pending.decisionId,
        expectedRevision: active.revision,
        payload: { action: "regenerate", instruction: text },
      },
    };
  }
  throw deepResearchRejected(
    "research-active",
    "A research is already in progress in this chat; continue or cancel it first.",
  );
}

/** Checks tool calling and a readable source before any model contact and returns the scope. */
export function preflightScope(
  searchMode: ResearchSearchMode,
  sources: ResearchSources,
): ResearchSourceScope {
  if (!sources.toolCalls) {
    throw deepResearchRejected(
      "research-preflight",
      "Deep Research needs a model with tool calling.",
    );
  }
  const index = sources.index && (searchMode === "indexOnly" || searchMode === "indexAndWeb");
  const web = sources.web && (searchMode === "webOnly" || searchMode === "indexAndWeb");
  if (index && web) return "indexAndWeb";
  if (index) return "indexOnly";
  if (web) return "webOnly";
  throw deepResearchRejected(
    "research-preflight",
    "Deep Research needs a readable source for this chat's search mode.",
  );
}
