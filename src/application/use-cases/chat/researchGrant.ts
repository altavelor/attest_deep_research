import type { SubAgentDelegationGrant } from "@application/ports/subAgent";
import {
  MAX_SUB_AGENT_SEARCHES,
  type ParentRunBinding,
  type SubAgentSourcePolicy,
} from "@core/research";
import {
  intersectScope,
  researchScopeId,
  type BranchAllocation,
  type ResearchBranch,
} from "@core/research/deepResearch";

const CHILD_MAX_RESULT_CHARS = 30_000;

/**
 * Builds the grant of one Deep Research branch attempt: bound to the branch's budget scope, with
 * the branch source scope intersected with the chat's policy, no active file or note mutation, and
 * the allocation's rounds and searches as limits. Throws when the branch shares no source with the chat.
 */
export function researchGrant(
  binding: ParentRunBinding,
  chatPolicy: SubAgentSourcePolicy,
  branch: ResearchBranch,
  allocation: BranchAllocation,
  researchId: string,
): SubAgentDelegationGrant {
  const chat = chatPolicy.searchMode === "none" ? null : chatPolicy.searchMode;
  const searchMode = chat ? intersectScope(branch.sourceScope, chat) : null;
  if (!searchMode) throw new Error("The branch has no source available in this chat.");
  return {
    binding,
    callerMode: "deep-research",
    budgetPolicy: { type: "required-scope", scopeId: researchScopeId(researchId, branch.branchId) },
    maximumSourcePolicy: {
      ...chatPolicy,
      searchMode,
      indexScope: searchMode === "webOnly" ? "none" : chatPolicy.indexScope,
      allowActiveFile: false,
      allowNoteMutation: false,
    },
    origin: "direct",
    limits: {
      maxRounds: allocation.modelRounds,
      maxResultChars: CHILD_MAX_RESULT_CHARS,
      maxSearches: Math.min(allocation.searches, MAX_SUB_AGENT_SEARCHES),
    },
  };
}
