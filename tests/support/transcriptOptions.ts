import { vi } from "vitest";
import { Component } from "obsidian";

import type { ChatTranscriptOptions } from "@apps/obsidian/ui/chat/ChatTranscript";

/** Builds transcript render options with inert callbacks, an identity translator and the given sub-agent events. */
export function transcriptOptions(
  state: { messages: ChatTranscriptOptions["messages"] } & Pick<
    ChatTranscriptOptions,
    "subAgentDispatches" | "subAgentNotices"
  >,
  onOpenSubAgentSession: (sessionId: string) => void,
): ChatTranscriptOptions {
  return {
    app: {} as never,
    markdownContext: new Component(),
    messages: state.messages,
    subAgentDispatches: state.subAgentDispatches,
    subAgentNotices: state.subAgentNotices,
    onOpenSubAgentSession,
    editingMessageIndex: null,
    assistantLabel: "Attest",
    isDebugMode: true,
    t: ((key: string) => key) as never,
    renderEmptyState: vi.fn(),
    onEditQuestion: vi.fn(),
    onSubmitEditedQuestion: vi.fn(),
    onOpenCitationPopover: vi.fn(),
    onScheduleCitationPopoverClose: vi.fn(),
    onScrollCitationBlockIntoView: vi.fn(),
    onOpenChunk: vi.fn(),
    onOpenToolOutput: vi.fn(),
    onHighlightCitation: vi.fn(),
    onOpenDiagnosticReport: vi.fn(),
    onSaveAnswerToNewNote: vi.fn(),
    onAppendAnswerToActiveNote: vi.fn(),
  };
}
