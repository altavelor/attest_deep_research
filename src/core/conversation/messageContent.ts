import { ChainItem, ChatDisplayMessage } from "./model";

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
  return value.replace(/\s+\*\*\s*$/, "").trim();
}

/**
 * Drops the display-only workflow fields (badge, attempt, untrusted marker and payload
 * state) from every chain item, so they are never persisted or sent to a model.
 */
export function stripChainDisplayFields(messages: ChatDisplayMessage[]): ChatDisplayMessage[] {
  return messages.map((message) => {
    const chain = message.researchProgress?.chain;
    if (!chain || !chain.some(hasDisplayFields)) return message;
    return {
      ...message,
      researchProgress: { ...message.researchProgress!, chain: chain.map(stripChainItem) },
    };
  });
}

function hasDisplayFields(item: ChainItem): boolean {
  if (item.kind !== "tool-call") return false;
  return (
    item.badge !== undefined ||
    item.attempt !== undefined ||
    item.untrusted !== undefined ||
    item.payloadState !== undefined ||
    (item.children ?? []).some(hasDisplayFields)
  );
}

function stripChainItem(item: ChainItem): ChainItem {
  if (item.kind !== "tool-call") return item;
  const {
    badge: _badge,
    attempt: _attempt,
    untrusted: _untrusted,
    payloadState: _payloadState,
    ...rest
  } = item;
  return rest.children ? { ...rest, children: rest.children.map(stripChainItem) } : rest;
}
