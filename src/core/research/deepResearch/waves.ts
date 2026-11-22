import type { ResearchLimits } from "./types";

const MAX_WAVE_SIZE = 4;
const SCOPE_PREFIX = "research:";

/** Returns how many works run at once: up to four children on a parallel-capable provider, else one. */
export function waveSize(limits: ResearchLimits, parallelRequests: boolean): number {
  return parallelRequests ? Math.max(1, Math.min(MAX_WAVE_SIZE, limits.childSessions)) : 1;
}

/**
 * Chooses where a branch work runs: in its child session when the branch already has one or the
 * distinct-session ceiling still allows a new one, counting new sessions already in flight, and on
 * the main path otherwise.
 */
export function branchPath(
  sessionByBranch: Readonly<Record<string, string>>,
  branchId: string,
  newSessionsInFlight: number,
  ceiling: number,
): "main" | "sub-agent" {
  if (sessionByBranch[branchId] !== undefined) return "sub-agent";
  return Object.keys(sessionByBranch).length + newSessionsInFlight < ceiling ? "sub-agent" : "main";
}

/** Returns the budget scope of one branch of a research; the manager treats it as opaque. */
export function researchScopeId(researchId: string, branchId: string): string {
  return `${SCOPE_PREFIX}${researchId}:${branchId}`;
}

/** Splits a research budget scope into its research and branch, or returns null for any other scope. */
export function parseResearchScope(
  scopeId: string,
): { researchId: string; branchId: string } | null {
  if (!scopeId.startsWith(SCOPE_PREFIX)) return null;
  const parts = scopeId.slice(SCOPE_PREFIX.length).split(":");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return null;
  return { researchId: parts[0]!, branchId: parts[1]! };
}
