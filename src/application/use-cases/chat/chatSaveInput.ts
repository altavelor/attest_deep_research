import type { ResearchAnswer } from "@core/answer";
import { inferChatTitle, type SaveChatInput } from "@core/chat/savedChat";
import { normalizeSubAgentTimeline } from "@core/chat/subAgentTimeline";
import { stripChainDisplayFields, stripMessageDiagnostics } from "@core/conversation";
import type { ChatSessionState } from "./chatSessionTypes";

/**
 * Builds the persisted form of a live session: one normalized parent timeline, no
 * display-only chain fields, and diagnostics only when the user keeps them.
 */
export function chatSaveInput(state: ChatSessionState, persistDiagnostics: boolean): SaveChatInput {
  const timeline = normalizeSubAgentTimeline(state);
  const displayFree = stripChainDisplayFields(timeline.messages);
  return {
    id: state.chatId ?? undefined,
    title: inferChatTitle(state.messages),
    messages: persistDiagnostics ? displayFree : stripMessageDiagnostics(displayFree),
    lastAnswer: persistDiagnostics
      ? state.lastAnswer
      : stripAnswerContextDiagnostics(state.lastAnswer),
    attachedContextPaths: state.attachedContextPaths,
    chatSettings: state.chatSettings,
    sourceRegistry: state.sourceRegistry,
    subAgentDispatches: [...timeline.subAgentDispatches],
    subAgentNotices: [...timeline.subAgentNotices],
    timelineSequence: timeline.timelineSequence,
  };
}

function stripAnswerContextDiagnostics(answer: ResearchAnswer | null): ResearchAnswer | null {
  if (!answer?.contextDiagnostics) return answer;
  const { contextDiagnostics: _contextDiagnostics, ...rest } = answer;
  return rest;
}
