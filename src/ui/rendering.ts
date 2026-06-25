// Backward-compatibility barrel for UI importers (stage 1, task 2.2).
// Conversation model + pure reducers live in core/conversation; presentation
// formatters live in ./conversationFormatting. Existing UI modules import from
// here; new code should import from the owning module directly.

export type {
  ConversationCompactionSummary,
  ChatDisplayMessage,
  ReasoningSegment,
  AssistantReasoningState,
  ResearchProgressCheckpoint,
  ChainItem,
  AssistantResearchProgress,
} from "../core/conversation";
export {
  nextAssistantMessage,
  nextAssistantReasoning,
  nextAssistantCheckpoint,
  completeAssistantCheckpoint,
  resetLastAssistantContent,
  finalizeLastAssistantReasoning,
  interruptLastAssistantProgress,
  nextChainToolCallStart,
  nextChainToolCallEnd,
  nextChainReasoningSegment,
  attachAnswerDetailsToLastAssistantMessage,
  stampLastAssistantModel,
  shouldShowDiagnosticAction,
  stripMessageDiagnostics,
  messageMarkdownContent,
  stripFollowUpSection,
  stripCitationsSection,
  cleanupDanglingMarkdown,
} from "../core/conversation";

export type { CitationTarget } from "./conversationFormatting";
export {
  formatIndexingStatus,
  formatIndexingStateLabel,
  formatIndexControlSummary,
  formatProgressPercent,
  indexingProgressValue,
  formatIndexingProgressLabel,
  citationTarget,
  messageDisplayContent,
} from "./conversationFormatting";
