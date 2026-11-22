import type { ResearchSearchMode } from "@core/research";
import {
  MAX_RESEARCH_QUESTION_CHARS,
  MAX_RESEARCH_TEXT_CHARS,
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
 * Resolves the turn a Deep Research message stands for. Explicit input wins; plain text starts a
 * research when none is active, is the regeneration instruction of a pending plan decision and the
 * free-text answer of a pending clarification.
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
  if (!input && active.pending?.kind === "clarification") {
    return {
      type: "decision",
      decision: {
        researchId: active.researchId,
        decisionId: active.pending.decisionId,
        expectedRevision: active.revision,
        payload: { action: "reply", text },
      },
    };
  }
  throw deepResearchRejected(
    "research-active",
    "A research is already in progress in this chat; continue or cancel it first.",
  );
}

/**
 * Tells whether a turn abandons a research left in planning by a dead turn. A chat runs one turn
 * at a time, so planning found at turn start is never live; a start or plain message replaces it.
 */
export function abandonsPlanning(
  input: ResearchTurnInput | undefined,
  active: ResearchState | null,
): boolean {
  return active?.phase === "planning" && (input === undefined || input.type === "start");
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

/** Rejects a start question or a plain-text plan instruction over its stored bound, before any commit. */
export function checkTurnText(turn: ResearchTurnInput, text: string): void {
  const payload =
    turn.type === "decision"
      ? (turn.decision.payload as { instruction?: unknown; text?: unknown })
      : null;
  const instruction = payload?.instruction ?? payload?.text;
  if (turn.type === "start" && text.length > MAX_RESEARCH_QUESTION_CHARS) {
    throw tooLong("question", MAX_RESEARCH_QUESTION_CHARS);
  }
  if (typeof instruction === "string" && instruction.length > MAX_RESEARCH_TEXT_CHARS) {
    throw tooLong("plan instruction", MAX_RESEARCH_TEXT_CHARS);
  }
}

function tooLong(subject: string, max: number): Error {
  return deepResearchRejected(
    "research-input-too-long",
    `The research ${subject} is too long; keep it under ${max.toLocaleString("en-US")} characters.`,
  );
}
