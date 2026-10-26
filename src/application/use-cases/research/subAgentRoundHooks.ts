import type { SubAgentParentRun } from "@application/ports/subAgent";
import {
  formatDeliveredSubAgentResults,
  type SubAgentEvidenceTarget,
} from "@application/research/subAgentResults";
import type { SubAgentRunRef } from "@core/research";

/** Parent model loop hooks that deliver child results at round boundaries. */
export interface ThinkingRoundHooks {
  beforeModelRound(deliverable: boolean): Promise<string | null>;
  afterRoundAccepted(): void;
  beforeFinalize(signal?: AbortSignal): Promise<"ready" | "resume-with-results">;
}

/**
 * Adapts the parent coordinator to the Thinking loop: new terminal child results become
 * one service message for the next round, aliased into the run's evidence registry, and
 * are acknowledged only once that round was accepted. When the provider continues a
 * response and cannot take a message, results are acknowledged and left to
 * get_subagent_result, so the completion barrier never loops on them.
 */
export function subAgentRoundHooks(
  parent: SubAgentParentRun,
  evidence: SubAgentEvidenceTarget,
): ThinkingRoundHooks {
  let delivered: { ref: SubAgentRunRef; resultRevision: number }[] = [];
  return {
    async beforeModelRound(deliverable) {
      const results = await parent.coordinator.beforeModelRound();
      if (results.length === 0) return null;
      const acknowledged = results.map(({ ref, result }) => ({
        ref,
        resultRevision: result.resultRevision,
      }));
      if (!deliverable) {
        parent.coordinator.acknowledgeResults(acknowledged);
        return null;
      }
      delivered = acknowledged;
      return formatDeliveredSubAgentResults(results, parent.resolver, evidence);
    },
    afterRoundAccepted() {
      if (delivered.length === 0) return;
      parent.coordinator.acknowledgeResults(delivered);
      delivered = [];
    },
    beforeFinalize: (signal) => parent.coordinator.beforeFinalize(signal),
  };
}
