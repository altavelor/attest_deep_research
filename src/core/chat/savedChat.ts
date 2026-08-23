import { ChatDisplayMessage } from "@core/conversation/model";
import { ResearchAnswer } from "@core/answer";
import { ResearchSearchMode } from "@core/research/searchMode";
import { ResearchMode } from "@core/research/researchMode";
import { ContextMode } from "@core/diagnostics";
import {
  canonicalSourceKey,
  ConversationSourceRegistry,
  createConversationSourceRegistry,
} from "./sourceRegistry";

export const CHAT_SCHEMA_VERSION = 3;
const SAFE_CHAT_ID = /^[a-zA-Z0-9_-]+$/;

export interface SavedChatSettings {
  chatModelProfileId: string;
  indexProfileId?: string;
  searchMode: ResearchSearchMode;
  contextMode?: ContextMode;

  researchMode?: ResearchMode;
}

export interface SavedChat {
  schemaVersion: 3;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  attachedContextPaths: string[];
  chatSettings: SavedChatSettings;
  sourceRegistry: ConversationSourceRegistry;

  isFavorite?: boolean;
}

export interface SavedChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  isFavorite: boolean;
}

export interface SaveChatInput {
  id?: string;
  title?: string;
  createdAt?: string;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  attachedContextPaths: string[];
  chatSettings: SavedChatSettings;
  sourceRegistry?: ConversationSourceRegistry;
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
  return parseSavedChat(value) !== null;
}

/** Converts the legacy v2 wire format into the current in-memory chat shape. */
export function parseSavedChat(value: unknown): SavedChat | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const chat = value as Partial<SavedChat> & { schemaVersion?: unknown };
  if (!hasSavedChatBase(chat)) return null;

  if (chat.schemaVersion === CHAT_SCHEMA_VERSION) {
    return isConversationSourceRegistry(chat.sourceRegistry) ? (chat as SavedChat) : null;
  }
  if (chat.schemaVersion !== 2) return null;

  return {
    ...(chat as Omit<SavedChat, "schemaVersion" | "sourceRegistry">),
    schemaVersion: CHAT_SCHEMA_VERSION,
    sourceRegistry: createConversationSourceRegistry(),
  };
}

function hasSavedChatBase(chat: Partial<SavedChat>): boolean {
  return (
    typeof chat.id === "string" &&
    isSafeChatId(chat.id) &&
    typeof chat.title === "string" &&
    typeof chat.createdAt === "string" &&
    typeof chat.updatedAt === "string" &&
    Array.isArray(chat.messages) &&
    Array.isArray(chat.attachedContextPaths) &&
    (chat.isFavorite === undefined || typeof chat.isFavorite === "boolean") &&
    (chat.lastAnswer === null || typeof chat.lastAnswer === "object") &&
    isSavedChatSettings(chat.chatSettings)
  );
}

function isConversationSourceRegistry(value: unknown): value is ConversationSourceRegistry {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray((value as { sources?: unknown }).sources)
  ) {
    return false;
  }
  const registry = value as ConversationSourceRegistry;
  const sourceIds = new Set<string>();
  const revisionIds = new Set<string>();
  const identities = new Set<string>();
  return registry.sources.every((source) => {
    const identityKey = `${source.identity?.kind}:${source.identity?.canonicalKey}`;
    if (
      !nonEmptyString(source.id) ||
      sourceIds.has(source.id) ||
      !nonEmptyString(source.title) ||
      !source.identity ||
      !isSourceKind(source.identity.kind) ||
      !nonEmptyString(source.identity.canonicalKey) ||
      identities.has(identityKey) ||
      !Array.isArray(source.revisions)
    ) {
      return false;
    }
    sourceIds.add(source.id);
    identities.add(identityKey);
    let activeRevisionCount = 0;
    return source.revisions.every((revision) => {
      if (revision.status === "active") activeRevisionCount += 1;
      if (
        !nonEmptyString(revision.id) ||
        !revision.id.startsWith(`${source.id}:revision-`) ||
        revisionIds.has(revision.id) ||
        !nonEmptyString(revision.contentHash) ||
        !nonEmptyString(revision.capturedAt) ||
        !isRevisionStatus(revision.status) ||
        !Array.isArray(revision.chunks) ||
        revision.chunks.length === 0 ||
        !revision.chunks.every(
          (chunk) =>
            isRetrievedChunk(chunk) &&
            chunk.source.kind === source.identity.kind &&
            canonicalSourceKey(chunk.source) === source.identity.canonicalKey,
        ) ||
        !Array.isArray(revision.usages) ||
        !revision.usages.every(isRevisionUsage) ||
        activeRevisionCount > 1
      ) {
        return false;
      }
      revisionIds.add(revision.id);
      return true;
    });
  });
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSourceKind(value: unknown): boolean {
  return value === "web" || value === "markdown" || value === "pdf" || value === "document";
}

function isRevisionStatus(value: unknown): boolean {
  return value === "active" || value === "superseded" || value === "unavailable";
}

function isRevisionUsage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const usage = value as { messageId?: unknown; citationOffsets?: unknown };
  return (
    nonEmptyString(usage.messageId) &&
    Array.isArray(usage.citationOffsets) &&
    usage.citationOffsets.every((offset) => Number.isSafeInteger(offset) && (offset as number) >= 0)
  );
}

function isRetrievedChunk(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const chunk = value as Record<string, unknown>;
  return (
    nonEmptyString(chunk.id) &&
    typeof chunk.text === "string" &&
    nonEmptyString(chunk.contentHash) &&
    typeof chunk.score === "number" &&
    Number.isFinite(chunk.score) &&
    isSourceReference(chunk.source)
  );
}

function isSourceReference(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  if (!nonEmptyString(source.id) || !nonEmptyString(source.title) || !isSourceKind(source.kind)) {
    return false;
  }
  if (source.kind === "web") {
    return (
      nonEmptyString(source.url) &&
      typeof source.snippet === "string" &&
      typeof source.retrievedAt === "string" &&
      typeof source.wasContentFetched === "boolean"
    );
  }
  if (!nonEmptyString(source.path)) return false;
  if (source.kind === "markdown") return Array.isArray(source.headingPath);
  if (source.kind === "pdf") return Number.isSafeInteger(source.pageNumber);
  return (
    source.format === "fb2" ||
    source.format === "epub" ||
    source.format === "txt" ||
    source.format === "docx"
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
      settings.contextMode === "filter") &&
    (settings.researchMode === undefined ||
      settings.researchMode === "instant" ||
      settings.researchMode === "thinking" ||
      settings.researchMode === "deep-research")
  );
}
