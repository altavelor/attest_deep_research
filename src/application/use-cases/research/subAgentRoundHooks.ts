import type { SubAgentParentRun } from "@application/ports/subAgent";
import {
  formatDeliveredSubAgentResults,
  type SubAgentEvidenceTarget,
} from "@application/research/subAgentResults";
import type { SubAgentRunRef } from "@core/research";

/** Parent model loop hooks that deliver child results at round boundaries. */
export interface ThinkingRoundHooks {
  beforeModelRound(): Promise<string | null>;
  afterRoundAccepted(): void;
  beforeFinalize(signal?: AbortSignal): Promise<"ready" | "resume-with-results">;
}

/**
 * Adapts the parent coordinator to the Thinking loop: new terminal child results become
 * one service message for the next round, aliased into the run's evidence registry, and
 * are acknowledged only once a round that carried them, as a message or as service
 * input of a continued provider response, was accepted.
 */
export function subAgentRoundHooks(
  parent: SubAgentParentRun,
  evidence: SubAgentEvidenceTarget,
): ThinkingRoundHooks {
  let delivered: { ref: SubAgentRunRef; resultRevision: number }[] = [];
  return {
    async beforeModelRound() {
      const results = await parent.coordinator.beforeModelRound();
      if (results.length === 0) return null;
      const acknowledged = results.map(({ ref, result }) => ({
        ref,
        resultRevision: result.resultRevision,
      }));
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
