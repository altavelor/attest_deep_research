import { ResearchMode } from "@core/research/researchMode";
import { AssistantResearchProgress, ChainItem, ChatDisplayMessage } from "./model";

/**
 * Create the placeholder assistant message for a run. The research mode is
 * recorded on the progress so the transcript can tell an Instant run — which
 * never produces reasoning or tool nodes — from an agentic one.
 */
export function startAssistantProgress(
  messages: ChatDisplayMessage[],
  mode: ResearchMode,
): ChatDisplayMessage[] {
  const createdAt = new Date().toISOString();
  const assistant: ChatDisplayMessage = { role: "assistant", content: "", createdAt };
  return [
    ...messages,
    {
      ...assistant,
      researchProgress: { ...researchProgressFromMessage(assistant, createdAt), mode },
    },
  ];
}

export function nextAssistantReasoning(
  messages: ChatDisplayMessage[],
  segmentId: string,
  delta: string,
): ChatDisplayMessage[] {
  const { assistant, existed } = lastAssistant(messages);
  const now = new Date().toISOString();
  const progress = researchProgressFromMessage(assistant, now);
  const segments = [...progress.reasoning.segments];
  const index = segments.findIndex((segment) => segment.id === segmentId);
  if (index >= 0)
    segments[index] = { ...segments[index], content: `${segments[index].content}${delta}` };
  else segments.push({ id: segmentId, kind: "summary", content: delta });
  return replaceLastAssistant(messages, existed, {
    ...assistant,
    researchProgress: {
      ...progress,
      phase: "streaming",
      reasoning: {
        ...progress.reasoning,
        phase: "streaming",
        startedAt: progress.reasoning.startedAt ?? now,
        segments,
      },
    },
  });
}

export function nextAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
  round: number,
  delta: string,
): ChatDisplayMessage[] {
  const { assistant, existed } = lastAssistant(messages);
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const checkpoints = [...progress.checkpoints];
  const index = checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index >= 0)
    checkpoints[index] = {
      ...checkpoints[index],
      content: `${checkpoints[index].content}${delta}`,
      status: "streaming",
    };
  else checkpoints.push({ id: checkpointId, round, content: delta, status: "streaming" });
  return replaceLastAssistant(messages, existed, {
    ...assistant,
    researchProgress: { ...progress, phase: "streaming", checkpoints },
  });
}

export function completeAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
): ChatDisplayMessage[] {
  return updateCheckpoints(messages, (checkpoint) =>
    checkpoint.id === checkpointId ? { ...checkpoint, status: "complete" } : checkpoint,
  );
}
export function promoteAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
): ChatDisplayMessage[] {
  return updateCheckpoints(messages, (checkpoint) =>
    checkpoint.id === checkpointId ? { ...checkpoint, status: "finalizing" } : checkpoint,
  );
}

export function finalizeLastAssistantReasoning(
  messages: ChatDisplayMessage[],
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  const completedAt = new Date().toISOString();
  const startedAt = last.researchProgress.reasoning.startedAt;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...last.researchProgress,
        phase: "complete",
        reasoning: {
          ...last.researchProgress.reasoning,
          phase: "complete",
          completedAt,
          ...(startedAt
            ? { durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) }
            : {}),
        },
        checkpoints: last.researchProgress.checkpoints.map((checkpoint) =>
          checkpoint.status === "streaming" ? { ...checkpoint, status: "interrupted" } : checkpoint,
        ),
      },
    },
  ];
}

export function interruptLastAssistantProgress(
  messages: ChatDisplayMessage[],
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  const finalizingContent = last.researchProgress.checkpoints.reduce<string | undefined>(
    (content, checkpoint) => (checkpoint.status === "finalizing" ? checkpoint.content : content),
    undefined,
  );
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      content: last.content || finalizingContent || "",
      researchProgress: {
        ...last.researchProgress,
        phase: "interrupted",
        reasoning: { ...last.researchProgress.reasoning, phase: "interrupted" },
        checkpoints: last.researchProgress.checkpoints.map((checkpoint) =>
          checkpoint.status === "streaming" || checkpoint.status === "finalizing"
            ? { ...checkpoint, status: "interrupted" }
            : checkpoint,
        ),
      },
    },
  ];
}

export function nextChainToolCallStart(
  messages: ChatDisplayMessage[],
  id: string,
  name: string,
  label: string,
  args?: Record<string, unknown>,
  parentId?: string,
  fetchTargets?: string[],
  searchSources?: string[],
): ChatDisplayMessage[] {
  const { assistant, existed } = lastAssistant(messages);
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const item: ChainItem = {
    kind: "tool-call",
    id,
    name,
    label,
    status: "pending",
    args,
    ...(fetchTargets?.length ? { fetchTargets } : {}),
    ...(searchSources?.length ? { searchSources } : {}),
  };
  const chain = parentId ? appendChild(progress.chain, parentId, item) : [...progress.chain, item];
  return replaceLastAssistant(messages, existed, {
    ...assistant,
    researchProgress: { ...progress, chain },
  });
}

export function nextChainToolCallEnd(
  messages: ChatDisplayMessage[],
  id: string,
  ok: boolean,
  resolvedLabel?: string,
  resultSummary?: string,
  resultJson?: string,
  parentId?: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  const apply = (item: Extract<ChainItem, { kind: "tool-call" }>): ChainItem => ({
    ...item,
    status: ok ? "complete" : "failed",
    ...(resolvedLabel !== undefined ? { label: resolvedLabel } : {}),
    ...(resultSummary !== undefined ? { resultSummary } : {}),
    ...(resultJson !== undefined ? { resultJson } : {}),
  });
  const chain = parentId
    ? updateChild(last.researchProgress.chain, parentId, id, apply)
    : last.researchProgress.chain.map((item) =>
        item.kind === "tool-call" && item.id === id ? apply(item) : item,
      );
  return [
    ...messages.slice(0, -1),
    { ...last, researchProgress: { ...last.researchProgress, chain } },
  ];
}

export function nextChainSubAgentPhase(
  messages: ChatDisplayMessage[],
  parentId: string,
  phase: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  const chain = last.researchProgress.chain.map((item) =>
    item.kind === "tool-call" && item.id === parentId ? { ...item, phase } : item,
  );
  return [
    ...messages.slice(0, -1),
    { ...last, researchProgress: { ...last.researchProgress, chain } },
  ];
}
export function nextChainReasoningSegment(
  messages: ChatDisplayMessage[],
  segmentId: string,
  delta: string,
): ChatDisplayMessage[] {
  const { assistant, existed } = lastAssistant(messages);
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const chain = [...progress.chain];
  const index = chain.findIndex(
    (item) => item.kind === "reasoning" && item.segmentId === segmentId,
  );
  if (index >= 0) {
    const item = chain[index] as Extract<ChainItem, { kind: "reasoning" }>;
    chain[index] = { ...item, content: item.content + delta };
  } else chain.push({ kind: "reasoning", segmentId, content: delta });
  return replaceLastAssistant(messages, existed, {
    ...assistant,
    researchProgress: { ...progress, chain },
  });
}

function lastAssistant(messages: ChatDisplayMessage[]): {
  assistant: ChatDisplayMessage;
  existed: boolean;
} {
  const last = messages.at(-1);
  return last?.role === "assistant"
    ? { assistant: last, existed: true }
    : {
        assistant: { role: "assistant", content: "", createdAt: new Date().toISOString() },
        existed: false,
      };
}
function replaceLastAssistant(
  messages: ChatDisplayMessage[],
  existed: boolean,
  assistant: ChatDisplayMessage,
): ChatDisplayMessage[] {
  return existed ? [...messages.slice(0, -1), assistant] : [...messages, assistant];
}
function updateCheckpoints(
  messages: ChatDisplayMessage[],
  apply: (
    checkpoint: AssistantResearchProgress["checkpoints"][number],
  ) => AssistantResearchProgress["checkpoints"][number],
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...last.researchProgress,
        checkpoints: last.researchProgress.checkpoints.map(apply),
      },
    },
  ];
}
function appendChild(chain: ChainItem[], parentId: string, child: ChainItem): ChainItem[] {
  return chain.map((item) =>
    item.kind === "tool-call" && item.id === parentId
      ? { ...item, children: [...(item.children ?? []), child] }
      : item,
  );
}
function updateChild(
  chain: ChainItem[],
  parentId: string,
  childId: string,
  apply: (item: Extract<ChainItem, { kind: "tool-call" }>) => ChainItem,
): ChainItem[] {
  return chain.map((item) =>
    item.kind !== "tool-call" || item.id !== parentId
      ? item
      : {
          ...item,
          children: (item.children ?? []).map((child) =>
            child.kind === "tool-call" && child.id === childId ? apply(child) : child,
          ),
        },
  );
}
function researchProgressFromMessage(
  message: ChatDisplayMessage,
  now: string,
): AssistantResearchProgress {
  return (
    message.researchProgress ?? {
      phase: "streaming",
      disclosure: "auto",
      view: "expanded",
      reasoning: { phase: "streaming", startedAt: now, segments: [] },
      checkpoints: [],
      chain: [],
    }
  );
}
