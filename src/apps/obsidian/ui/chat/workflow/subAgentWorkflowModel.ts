import type { AssistantResearchProgress, ChainItem } from "@core/conversation";
import type { SubAgentWorkflowItem } from "@core/research";
import type { WorkflowTimelineModel } from "./timelineModel";

/** Maps a sub-agent's tool projection onto the shared timeline model; a child timeline never carries reasoning or checkpoints. */
export function toSubAgentWorkflowModel(
  sessionId: string,
  items: readonly SubAgentWorkflowItem[],
  phase: AssistantResearchProgress["phase"],
): WorkflowTimelineModel {
  return {
    scopeId: `sub-agent:${sessionId}`,
    items: [...items].sort((a, b) => a.sequence - b.sequence).map(toChainItem),
    phase,
    reasoningSegments: [],
    checkpoints: [],
  };
}

function toChainItem(item: SubAgentWorkflowItem): ChainItem {
  return {
    kind: "tool-call",
    id: item.id,
    name: item.name,
    label: item.label,
    status: item.status,
    ...(item.args ? { args: item.args } : {}),
    ...(item.resultSummary !== undefined ? { resultSummary: item.resultSummary } : {}),
    ...(item.resultJson !== undefined ? { resultJson: item.resultJson } : {}),
    ...(item.badge ? { badge: item.badge } : {}),
    attempt: { runId: item.runId, round: item.round },
  };
}
