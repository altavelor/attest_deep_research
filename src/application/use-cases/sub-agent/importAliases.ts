import type { SubAgentPreparedImport } from "@application/ports/subAgent";
import {
  isSubAgentStateId,
  unresolvedSubAgentCitations,
  type ImportedSubAgentEvidenceReference,
} from "@core/research";

/**
 * Returns the bridge's aliases in item order when every admitted item got exactly one
 * alias with safe conversation IDs and its own child identity; null otherwise.
 */
export function checkedAliases(
  prepared: SubAgentPreparedImport,
  registered: readonly ImportedSubAgentEvidenceReference[],
): ImportedSubAgentEvidenceReference[] | null {
  const aliases: ImportedSubAgentEvidenceReference[] = [];
  for (const item of prepared.items) {
    const alias = registered.find(
      (entry) => entry.conversationEvidenceId === item.conversationEvidenceId,
    );
    if (
      !alias ||
      !isSubAgentStateId(alias.conversationSourceId) ||
      !isSubAgentStateId(alias.conversationRevisionId)
    ) {
      return null;
    }
    aliases.push({
      conversationEvidenceId: item.conversationEvidenceId,
      conversationSourceId: alias.conversationSourceId,
      conversationRevisionId: alias.conversationRevisionId,
      subAgentEvidenceId: item.subAgentEvidenceId,
      subAgentSessionId: prepared.sessionId,
      subAgentRunId: prepared.runId,
      collectedAt: item.collectedAt,
      attempt: item.attempt,
      incomplete: item.incomplete,
    });
  }
  const known = new Set(aliases.map((alias) => alias.conversationEvidenceId));
  return unresolvedSubAgentCitations(prepared.answerText, known).length === 0 ? aliases : null;
}
