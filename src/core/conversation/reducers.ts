import { ContextDiagnostics } from "@core/diagnostics";
import { ResearchAnswer } from "@core/answer";
import { RetrievedChunk } from "@core/model/source";
import { createMessageId } from "./messageIds";

import { ChatDisplayMessage } from "./model";

export {
  cleanupDanglingMarkdown,
  messageMarkdownContent,
  shouldShowAnswerNoteActions,
  shouldShowDiagnosticAction,
  stripCitationsSection,
  stripFollowUpSection,
  stripMessageDiagnostics,
} from "./messageContent";
export {
  completeAssistantCheckpoint,
  finalizeLastAssistantReasoning,
  interruptLastAssistantProgress,
  nextAssistantCheckpoint,
  nextAssistantReasoning,
  nextChainReasoningSegment,
  nextChainSubAgentPhase,
  nextChainToolCallEnd,
  nextChainToolCallStart,
  promoteAssistantCheckpoint,
  startAssistantProgress,
} from "./researchProgressReducers";

export function nextUserMessage(
  messages: ChatDisplayMessage[],
  content: string,
  contextPaths: readonly string[] = [],
): ChatDisplayMessage[] {
  return [
    ...messages,
    {
      id: createMessageId(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
      ...(contextPaths.length > 0 ? { contextPaths: [...contextPaths] } : {}),
    },
  ];
}

export function nextAssistantMessage(
  messages: ChatDisplayMessage[],
  delta: string,
): ChatDisplayMessage[] {
  const last = messages.at(-1);
  if (last?.role === "assistant")
    return [
      ...messages.slice(0, -1),
      { ...last, role: "assistant", content: `${last.content}${delta}`, createdAt: last.createdAt },
    ];
  return [
    ...messages,
    {
      id: createMessageId(),
      role: "assistant",
      content: delta,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function resetLastAssistantContent(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  const last = messages.at(-1);
  return last?.role === "assistant"
    ? [...messages.slice(0, -1), { ...last, content: "" }]
    : messages;
}

export function attachAnswerDetailsToLastAssistantMessage(
  messages: ChatDisplayMessage[],
  answer: {
    finalAnswer?: ResearchAnswer;
    evidence?: RetrievedChunk[];
    contextDiagnostics?: ContextDiagnostics;
    isFallback?: true;
    fallbackReason?: string;
  },
): ChatDisplayMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") continue;
    return [
      ...messages.slice(0, index),
      {
        ...messages[index],
        ...(answer.finalAnswer ? { content: answer.finalAnswer.answer } : {}),
        answer: answer.finalAnswer,
        evidence: answer.evidence ?? [],
        contextDiagnostics: answer.contextDiagnostics ?? answer.finalAnswer?.contextDiagnostics,
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
  if (!modelName) return messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant")
      return [
        ...messages.slice(0, index),
        { ...messages[index], modelName },
        ...messages.slice(index + 1),
      ];
  }
  return messages;
}
