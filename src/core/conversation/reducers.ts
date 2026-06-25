// Core conversation reducers (stage 1, task 2.1). Pure functions that evolve the
// transcript as streaming events arrive. No Obsidian/DOM dependency.

import { RetrievedChunk } from "../model/source";
import { ContextDiagnostics } from "../diagnostics";
import {
  AssistantResearchProgress,
  ChainItem,
  ChatDisplayMessage,
} from "./model";

export function nextAssistantMessage(
  messages: ChatDisplayMessage[],
  delta: string,
): ChatDisplayMessage[] {
  const last = messages[messages.length - 1];

  if (last?.role === "assistant") {
    return [
      ...messages.slice(0, -1),
      {
        ...last,
        role: "assistant",
        content: `${last.content}${delta}`,
        createdAt: last.createdAt,
      },
    ];
  }

  return [...messages, { role: "assistant", content: delta, createdAt: new Date().toISOString() }];
}

export function nextAssistantReasoning(
  messages: ChatDisplayMessage[],
  segmentId: string,
  delta: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  const assistant =
    last?.role === "assistant"
      ? last
      : { role: "assistant" as const, content: "", createdAt: new Date().toISOString() };
  const now = new Date().toISOString();
  const progress = researchProgressFromMessage(assistant, now);
  const reasoning = [...progress.reasoning.segments];
  const segmentIndex = reasoning.findIndex((segment) => segment.id === segmentId);
  if (segmentIndex >= 0) {
    reasoning[segmentIndex] = {
      ...reasoning[segmentIndex],
      content: `${reasoning[segmentIndex].content}${delta}`,
    };
  } else {
    reasoning.push({ id: segmentId, kind: "summary", content: delta });
  }
  const updated: ChatDisplayMessage = {
    ...assistant,
    researchProgress: {
      ...progress,
      phase: "streaming",
      reasoning: {
        ...progress.reasoning,
        phase: "streaming",
        startedAt: progress.reasoning.startedAt ?? now,
        segments: reasoning,
      },
    },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

export function nextAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
  round: number,
  delta: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  const assistant =
    last?.role === "assistant"
      ? last
      : { role: "assistant" as const, content: "", createdAt: new Date().toISOString() };
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const checkpoints = [...progress.checkpoints];
  const index = checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId);
  if (index >= 0) {
    checkpoints[index] = {
      ...checkpoints[index],
      content: `${checkpoints[index].content}${delta}`,
      status: "streaming",
    };
  } else {
    checkpoints.push({ id: checkpointId, round, content: delta, status: "streaming" });
  }
  const updated = {
    ...assistant,
    researchProgress: { ...progress, phase: "streaming" as const, checkpoints },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

export function completeAssistantCheckpoint(
  messages: ChatDisplayMessage[],
  checkpointId: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...last.researchProgress,
        checkpoints: last.researchProgress.checkpoints.map((checkpoint) =>
          checkpoint.id === checkpointId
            ? { ...checkpoint, status: "complete" as const }
            : checkpoint,
        ),
      },
    },
  ];
}

export function resetLastAssistantContent(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return messages;
  return [...messages.slice(0, -1), { ...last, content: "" }];
}

export function finalizeLastAssistantReasoning(
  messages: ChatDisplayMessage[],
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return messages;
  const progress = last.researchProgress;
  if (!progress) return messages;
  const completedAt = new Date().toISOString();
  const startedAt = progress.reasoning.startedAt;
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...progress,
        phase: "complete",
        reasoning: {
          ...progress.reasoning,
          phase: "complete",
          completedAt,
          ...(startedAt
            ? { durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) }
            : {}),
        },
        checkpoints: progress.checkpoints.map((checkpoint) =>
          checkpoint.status === "streaming"
            ? { ...checkpoint, status: "interrupted" as const }
            : checkpoint,
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
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      researchProgress: {
        ...last.researchProgress,
        phase: "interrupted",
        reasoning: { ...last.researchProgress.reasoning, phase: "interrupted" },
        checkpoints: last.researchProgress.checkpoints.map((checkpoint) =>
          checkpoint.status === "streaming"
            ? { ...checkpoint, status: "interrupted" as const }
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
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  const assistant =
    last?.role === "assistant"
      ? last
      : { role: "assistant" as const, content: "", createdAt: new Date().toISOString() };
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const item: ChainItem = { kind: "tool-call", id, name, label, status: "pending", args };
  const updated: ChatDisplayMessage = {
    ...assistant,
    researchProgress: { ...progress, chain: [...progress.chain, item] },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

export function nextChainToolCallEnd(
  messages: ChatDisplayMessage[],
  id: string,
  ok: boolean,
  resolvedLabel?: string,
  resultSummary?: string,
  resultJson?: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || !last.researchProgress) return messages;
  const chain = last.researchProgress.chain.map((item) =>
    item.kind === "tool-call" && item.id === id
      ? {
          ...item,
          status: (ok ? "complete" : "failed") as "complete" | "failed",
          ...(resolvedLabel !== undefined ? { label: resolvedLabel } : {}),
          ...(resultSummary !== undefined ? { resultSummary } : {}),
          ...(resultJson !== undefined ? { resultJson } : {}),
        }
      : item,
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
  const last = messages.at(-1);
  const assistant =
    last?.role === "assistant"
      ? last
      : { role: "assistant" as const, content: "", createdAt: new Date().toISOString() };
  const progress = researchProgressFromMessage(assistant, new Date().toISOString());
  const chain = [...progress.chain];
  const index = chain.findIndex(
    (item) => item.kind === "reasoning" && item.segmentId === segmentId,
  );
  if (index >= 0) {
    const existing = chain[index] as Extract<ChainItem, { kind: "reasoning" }>;
    chain[index] = { ...existing, content: existing.content + delta };
  } else {
    chain.push({ kind: "reasoning", segmentId, content: delta });
  }
  const updated: ChatDisplayMessage = {
    ...assistant,
    researchProgress: { ...progress, chain },
  };
  return last?.role === "assistant" ? [...messages.slice(0, -1), updated] : [...messages, updated];
}

function researchProgressFromMessage(
  message: ChatDisplayMessage,
  now: string,
): AssistantResearchProgress {
  if (message.researchProgress) return message.researchProgress;
  return {
    phase: "streaming",
    disclosure: "auto",
    view: "expanded",
    reasoning: {
      phase: "streaming",
      startedAt: now,
      segments: (message.reasoning ?? []).map((segment) => ({ ...segment, kind: "summary" })),
    },
    checkpoints: [],
    chain: [],
  };
}

export function attachAnswerDetailsToLastAssistantMessage(
  messages: ChatDisplayMessage[],
  answer: {
    evidence?: RetrievedChunk[];
    contextDiagnostics?: ContextDiagnostics;
    isFallback?: true;
    fallbackReason?: string;
  },
): ChatDisplayMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") {
      continue;
    }

    return [
      ...messages.slice(0, index),
      {
        ...messages[index],
        evidence: answer.evidence ?? [],
        contextDiagnostics: answer.contextDiagnostics,
        ...(answer.isFallback
          ? { isFallback: true as const, fallbackReason: answer.fallbackReason }
          : {}),
      },
      ...messages.slice(index + 1),
    ];
  }

  return messages;
}

export function stampLastAssistantModel(
  messages: ChatDisplayMessage[],
  modelName: string,
): ChatDisplayMessage[] {
  if (!modelName) {
    return messages;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") {
      continue;
    }

    return [
      ...messages.slice(0, index),
      { ...messages[index], modelName },
      ...messages.slice(index + 1),
    ];
  }

  return messages;
}

export function shouldShowDiagnosticAction(
  message: ChatDisplayMessage,
  isDebugMode: boolean,
): boolean {
  return isDebugMode && message.role === "assistant" && message.contextDiagnostics !== undefined;
}

export function stripMessageDiagnostics(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  return messages.map((message) => {
    if (message.contextDiagnostics === undefined) {
      return message;
    }

    const { contextDiagnostics: _contextDiagnostics, ...rest } = message;
    return rest;
  });
}

export function messageMarkdownContent(message: ChatDisplayMessage): string {
  if (message.role === "user") {
    return message.content;
  }

  return cleanupDanglingMarkdown(stripFollowUpSection(stripCitationsSection(message.content)));
}

export function stripFollowUpSection(value: string): string {
  const sectionStart = value.search(/follow-up questions\s*:/i);

  return sectionStart === -1 ? value : value.slice(0, sectionStart).trim();
}

export function stripCitationsSection(value: string): string {
  const sectionStart = value.search(/(?:^|\n)#{1,3}\s*citations\s*$/im);

  return sectionStart === -1 ? value : value.slice(0, sectionStart).trim();
}

export function cleanupDanglingMarkdown(value: string): string {
  return value
    .replace(/(?:\n\s*)+\*\*\s*$/g, "")
    .replace(/\s+\*\*\s*$/g, "")
    .trim();
}
