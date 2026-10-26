import {
  parentWorkflowChain,
  type AssistantResearchProgress,
  type ChainItem,
  type ChatDisplayMessage,
} from "@core/conversation";
import type { ResearchMode } from "@core/research";

export interface WorkflowTimelineModel {
  scopeId: string;
  items: readonly ChainItem[];
  phase: AssistantResearchProgress["phase"];
  mode?: ResearchMode;
  reasoningSegments: AssistantResearchProgress["reasoning"]["segments"];
  checkpoints: AssistantResearchProgress["checkpoints"];
}

export interface WorkflowTimelineHandle {
  readonly rendered: boolean;
  dispose(): void;
}

/** Projects a chat message's research progress into the shared timeline model, without child details. */
export function toParentWorkflowModel(message: ChatDisplayMessage): WorkflowTimelineModel {
  const progress = message.researchProgress;
  return {
    scopeId: message.id ?? `message:${message.createdAt}`,
    items: parentWorkflowChain(progress?.chain ?? []),
    phase: progress?.phase ?? "idle",
    ...(progress?.mode ? { mode: progress.mode } : {}),
    reasoningSegments: progress?.reasoning.segments ?? [],
    checkpoints: progress?.checkpoints ?? [],
  };
}
