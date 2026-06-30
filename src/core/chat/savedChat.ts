// Saved-chat domain model + validation rules (stage 5). Platform-neutral: the
// DTOs reference only core types, and the validation/title helpers are pure. The
// filesystem persistence lives in adapters/filesystem; the repository port lives
// in application/ports.

import { ChatDisplayMessage } from "../conversation/model";
import { ResearchAnswer } from "../answer";
import { RetrievedChunk } from "../model/source";
import { ResearchSearchMode } from "../research/searchMode";
import { ContextMode } from "../diagnostics";

export const CHAT_SCHEMA_VERSION = 2;
const SAFE_CHAT_ID = /^[a-zA-Z0-9_-]+$/;

export interface SavedChatSettings {
  chatModelProfileId: string;
  indexProfileId?: string;
  searchMode: ResearchSearchMode;
  contextMode?: ContextMode;
}

export interface ExpandedCitationContext {
  citationKey: string;
  radius: number;
  chunks: RetrievedChunk[];
}

export interface SavedChat {
  schemaVersion: 2;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  attachedContextPaths: string[];
  expandedCitationContexts?: ExpandedCitationContext[];
  chatSettings: SavedChatSettings;
}

export interface SavedChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface SaveChatInput {
  id?: string;
  title?: string;
  createdAt?: string;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  attachedContextPaths: string[];
  expandedCitationContexts?: ExpandedCitationContext[];
  chatSettings: SavedChatSettings;
}

export function inferChatTitle(messages: ChatDisplayMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();

  if (!firstUserMessage) {
    return "Untitled chat";
  }

  const singleLine = firstUserMessage.replace(/\s+/g, " ");
  return singleLine.length <= 80 ? singleLine : `${singleLine.slice(0, 77)}...`;
}

export function normalizeTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  return normalized || "Untitled chat";
}

export function isSafeChatId(id: string): boolean {
  return SAFE_CHAT_ID.test(id);
}

export function isSavedChat(value: unknown): value is SavedChat {
  if (!value || typeof value !== "object") {
    return false;
  }

  const chat = value as Partial<SavedChat>;

  return (
    chat.schemaVersion === CHAT_SCHEMA_VERSION &&
    typeof chat.id === "string" &&
    isSafeChatId(chat.id) &&
    typeof chat.title === "string" &&
    typeof chat.createdAt === "string" &&
    typeof chat.updatedAt === "string" &&
    Array.isArray(chat.messages) &&
    Array.isArray(chat.attachedContextPaths) &&
    (chat.expandedCitationContexts === undefined || Array.isArray(chat.expandedCitationContexts)) &&
    (chat.lastAnswer === null || typeof chat.lastAnswer === "object") &&
    isSavedChatSettings(chat.chatSettings)
  );
}

function isSavedChatSettings(value: unknown): value is SavedChatSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<SavedChatSettings>;
  return (
    typeof settings.chatModelProfileId === "string" &&
    (settings.indexProfileId === undefined || typeof settings.indexProfileId === "string") &&
    (settings.searchMode === "none" ||
      settings.searchMode === "indexOnly" ||
      settings.searchMode === "indexAndWeb" ||
      settings.searchMode === "webOnly") &&
    (settings.contextMode === undefined ||
      settings.contextMode === "include" ||
      settings.contextMode === "filter")
  );
}
