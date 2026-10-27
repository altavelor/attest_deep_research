import {
  parentDisplayChain,
  type AssistantResearchProgress,
  type ChainItem,
  type ChatDisplayMessage,
} from "@core/conversation";
import type { ParentTimelineEvent } from "@core/chat/subAgentPlacement";
import type { ResearchMode } from "@core/research";

export interface WorkflowTimelineModel {
  scopeId: string;
  items: readonly ChainItem[];
  phase: AssistantResearchProgress["phase"];
  mode?: ResearchMode;
  reasoningSegments: AssistantResearchProgress["reasoning"]["segments"];
  checkpoints: AssistantResearchProgress["checkpoints"];
  events?: readonly ParentTimelineEvent[];
}

export interface WorkflowTimelineHandle {
  readonly rendered: boolean;
  dispose(): void;
}

/**
 * Projects a chat message's research progress into the shared timeline model, without
 * child details, carrying the sub-agent events of the message's run.
 */
export function toParentWorkflowModel(
  message: ChatDisplayMessage,
  events: readonly ParentTimelineEvent[] = [],
): WorkflowTimelineModel {
  const progress = message.researchProgress;
  return {
    scopeId: message.id ?? `message:${message.createdAt}`,
    items: parentDisplayChain(progress?.chain ?? []),
    phase: progress?.phase ?? "idle",
    ...(progress?.mode ? { mode: progress.mode } : {}),
    reasoningSegments: progress?.reasoning.segments ?? [],
    checkpoints: progress?.checkpoints ?? [],
    ...(events.length > 0 ? { events } : {}),
  };
}
