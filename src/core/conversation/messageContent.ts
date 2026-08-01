import { ChatDisplayMessage } from "./model";

export function shouldShowDiagnosticAction(
  message: ChatDisplayMessage,
  isDebugMode: boolean,
): boolean {
  return isDebugMode && message.role === "assistant" && message.contextDiagnostics !== undefined;
}

export function shouldShowAnswerNoteActions(message: ChatDisplayMessage): boolean {
  return message.role === "assistant" && message.answer !== undefined;
}

export function stripMessageDiagnostics(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  return messages.map((message) => {
    if (message.contextDiagnostics === undefined) return message;

    const { contextDiagnostics: _contextDiagnostics, ...rest } = message;
    return rest;
  });
}

/** Returns the assistant text that is safe to render in the transcript body. */
export function messageMarkdownContent(message: ChatDisplayMessage): string {
  if (message.role === "user") return message.content;

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
