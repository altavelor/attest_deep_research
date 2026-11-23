import { ChatDisplayMessage } from "@core/conversation/model";
import { ResearchAnswer } from "@core/answer";
import { ResearchSearchMode } from "@core/research/searchMode";
import { ResearchMode } from "@core/research/researchMode";
import { readAnswerClarification } from "@core/research/thinkingClarification";
import { ContextMode } from "@core/diagnostics";
import { parseSavedChatRunState, type SavedChatRunState } from "./chatSession";
import { condenseTitleText } from "./titlePolicy";
import {
  toValidatedJson,
  validateSubAgentState,
  type SubAgentDispatchEntry,
  type SubAgentNoticeEntry,
  type SubAgentStateSnapshot,
  type ValidatedJsonValue,
} from "@core/research/subAgent";
import {
  normalizeSubAgentTimeline,
  parseSubAgentDispatches,
  parseSubAgentNotices,
  parseTimelineSequence,
} from "./subAgentTimeline";
import {
  canonicalSourceKey,
  ConversationEvidenceRevision,
  ConversationSource,
  ConversationSourceRegistry,
  createConversationSourceRegistry,
} from "./sourceRegistry";
import {
  validateResearchSection,
  type DeepResearchSection,
  type ResearchSectionView,
} from "@core/research/deepResearch";

export const CHAT_SCHEMA_VERSION = 4;
const SAFE_CHAT_ID = /^[a-zA-Z0-9_-]+$/;

export interface SavedChatSettings {
  chatModelProfileId: string;
  indexProfileId?: string;
  searchMode: ResearchSearchMode;
  contextMode?: ContextMode;

  researchMode?: ResearchMode;
}

export interface SavedChat {
  schemaVersion: 4;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  attachedContextPaths: string[];
  chatSettings: SavedChatSettings;
  sourceRegistry: ConversationSourceRegistry;
  unreadCompletion: boolean;

  isFavorite?: boolean;
  lastRun?: SavedChatRunState;
  subAgents?: SavedChatSubAgents;
  deepResearch?: SavedChatDeepResearch;
  subAgentDispatches?: SubAgentDispatchEntry[];
  subAgentNotices?: SubAgentNoticeEntry[];
  timelineSequence?: number;
  recoveredFrom?: "previous";
}

export type SavedChatSubAgents =
  | { status: "ready"; snapshot: SubAgentStateSnapshot }
  | { status: "unreadable"; raw: ValidatedJsonValue; reason: string };

export type SavedChatDeepResearch =
  | { status: "ready"; section: DeepResearchSection }
  | { status: "unreadable"; raw: ValidatedJsonValue; reason: string };

export interface SavedChatSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  isFavorite: boolean;
  unreadCompletion: boolean;
  lastRun?: SavedChatRunState;
  requiresUserAction?: boolean;
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
  unreadCompletion?: boolean;
  lastRun?: SavedChatRunState;
  updatedAt?: string;
  subAgentDispatches?: SubAgentDispatchEntry[];
  subAgentNotices?: SubAgentNoticeEntry[];
  timelineSequence?: number;
  researchSection?: DeepResearchSection;
}

export function inferChatTitle(messages: ChatDisplayMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content ?? "";
  return condenseTitleText(firstUserMessage) || "Untitled chat";
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

/**
 * Accepts saved-chat wire formats v2, v3, and v4 and returns the v4 in-memory
 * shape. Older schemas gain `unreadCompletion: false` and no run metadata;
 * malformed optional v4 run metadata is discarded rather than failing the chat.
 */
export function parseSavedChat(value: unknown): SavedChat | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const chat = value as Partial<SavedChat>;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (!hasSavedChatBase(chat)) return null;
  if (schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) {
    return null;
  }

  const isCurrent = schemaVersion === CHAT_SCHEMA_VERSION;
  const lastRun = isCurrent
    ? parseSavedChatRunState((value as { lastRun?: unknown }).lastRun)
    : undefined;

  const {
    schemaVersion: _schemaVersion,
    sourceRegistry: _sourceRegistry,
    unreadCompletion: _unreadCompletion,
    lastRun: _lastRun,
    subAgents: _subAgents,
    deepResearch: _deepResearch,
    recoveredFrom: _recoveredFrom,
    subAgentDispatches: _subAgentDispatches,
    subAgentNotices: _subAgentNotices,
    timelineSequence: _timelineSequence,
    ...rest
  } = chat;
  const subAgents = parseSavedChatSubAgents((value as { subAgents?: unknown }).subAgents, chat.id!);
  const deepResearch = parseSavedChatDeepResearch(
    (value as { deepResearch?: unknown }).deepResearch,
  );
  const timeline = isCurrent ? parseSavedTimeline(value as Record<string, unknown>) : null;

  return {
    ...(rest as Omit<
      SavedChat,
      "schemaVersion" | "sourceRegistry" | "unreadCompletion" | "lastRun"
    >),
    messages: chat.messages!.map(withValidClarification),
    schemaVersion: CHAT_SCHEMA_VERSION,
    sourceRegistry:
      schemaVersion === 2
        ? createConversationSourceRegistry()
        : sanitizeConversationSourceRegistry(chat.sourceRegistry),
    unreadCompletion: isCurrent && chat.unreadCompletion === true,
    ...(lastRun ? { lastRun } : {}),
    ...(subAgents ? { subAgents } : {}),
    ...(deepResearch ? { deepResearch } : {}),
    ...(timeline ?? {}),
  };
}

/**
 * Reads the optional main-transcript sub-agent events of a v4 chat. They are validated
 * separately from the messages, so a damaged event is dropped without losing a message.
 */
function parseSavedTimeline(
  value: Record<string, unknown>,
): Pick<SavedChat, "subAgentDispatches" | "subAgentNotices" | "timelineSequence"> | null {
  if (
    value.subAgentDispatches === undefined &&
    value.subAgentNotices === undefined &&
    value.timelineSequence === undefined
  ) {
    return null;
  }
  const normalized = normalizeSubAgentTimeline({
    messages: [],
    subAgentDispatches: parseSubAgentDispatches(value.subAgentDispatches),
    subAgentNotices: parseSubAgentNotices(value.subAgentNotices),
    timelineSequence: parseTimelineSequence(value.timelineSequence),
  });
  return {
    subAgentDispatches: [...normalized.subAgentDispatches],
    subAgentNotices: [...normalized.subAgentNotices],
    timelineSequence: normalized.timelineSequence,
  };
}

/**
 * Reads the optional sub-agent section separately from the rest of the chat. An
 * absent section yields undefined; a section of another version, another chat or
 * with invalid content is kept verbatim as unreadable so it is never overwritten
 * with an empty state, while the chat itself stays readable.
 */
export function parseSavedChatSubAgents(
  value: unknown,
  chatId: string,
): SavedChatSubAgents | undefined {
  if (value === undefined) return undefined;
  const raw = toValidatedJson(value) ?? null;
  const validation = validateSubAgentState(value);
  if (!validation.ok) return { status: "unreadable", raw, reason: validation.message };
  if (validation.snapshot.chatId !== chatId) {
    return { status: "unreadable", raw, reason: "Sub-agent state belongs to another chat." };
  }
  return { status: "ready", snapshot: validation.snapshot };
}

/**
 * Reads the optional Deep Research section. An absent section yields undefined; an invalid
 * one is kept verbatim as unreadable so the chat stays readable and the section is never reset.
 */
export function parseSavedChatDeepResearch(value: unknown): SavedChatDeepResearch | undefined {
  if (value === undefined) return undefined;
  const validation = validateResearchSection(value);
  if (!validation.ok) {
    return {
      status: "unreadable",
      raw: toValidatedJson(value) ?? null,
      reason: validation.message,
    };
  }
  return { status: "ready", section: validation.value };
}

/** Presents a saved Deep Research section; an absent section is an empty ready one. */
export function researchSectionView(saved: SavedChatDeepResearch | undefined): ResearchSectionView {
  if (!saved) return { status: "ready", active: null, history: [] };
  if (saved.status === "unreadable") return { status: "unreadable", reason: saved.reason };
  return { status: "ready", active: saved.section.active, history: saved.section.history };
}

/** Drops a malformed clarification from a stored answer and keeps the rest of the message. */
function withValidClarification(message: ChatDisplayMessage): ChatDisplayMessage {
  const answer: unknown = isRecord(message) ? message.answer : undefined;
  if (!isRecord(answer) || answer.clarification === undefined) return message;
  const clarification = readAnswerClarification(answer.clarification);
  const { clarification: _stored, ...rest } = answer as unknown as ResearchAnswer;
  return {
    ...message,
    answer: clarification ? { ...rest, clarification } : rest,
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

function isSourceId(value: unknown): boolean {
  return typeof value === "string" && /^source-\d+$/u.test(value);
}

function isRevisionId(value: unknown, sourceId: string): boolean {
  return typeof value === "string" && new RegExp(`^${sourceId}:revision-\\d+$`, "u").test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Salvages the persisted registry: sources and revisions that do not satisfy the
 * schema are dropped, the rest are kept. Chat messages must never be lost
 * because a derived registry entry is malformed.
 */
function sanitizeConversationSourceRegistry(value: unknown): ConversationSourceRegistry {
  if (!isRecord(value) || !Array.isArray(value.sources)) return createConversationSourceRegistry();
  const sourceIds = new Set<string>();
  const revisionIds = new Set<string>();
  const identities = new Set<string>();
  const sources: ConversationSource[] = [];

  for (const candidate of value.sources) {
    if (!isRecord(candidate)) continue;
    const source = candidate as unknown as ConversationSource;
    const identityKey = `${source.identity?.kind}:${source.identity?.canonicalKey}`;
    if (
      !isSourceId(source.id) ||
      sourceIds.has(source.id) ||
      !nonEmptyString(source.title) ||
      !source.identity ||
      !isSourceKind(source.identity.kind) ||
      !nonEmptyString(source.identity.canonicalKey) ||
      identities.has(identityKey) ||
      !Array.isArray(source.revisions)
    ) {
      continue;
    }

    let hasActiveRevision = false;
    const revisions: ConversationEvidenceRevision[] = [];
    for (const revisionCandidate of source.revisions) {
      if (!isRecord(revisionCandidate)) continue;
      const revision = revisionCandidate as unknown as ConversationEvidenceRevision;
      if (
        !isRevisionId(revision.id, source.id) ||
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
        (revision.status === "active" && hasActiveRevision)
      ) {
        continue;
      }
      if (revision.status === "active") hasActiveRevision = true;
      revisionIds.add(revision.id);
      revisions.push(revision);
    }

    if (revisions.length === 0) continue;
    sourceIds.add(source.id);
    identities.add(identityKey);
    sources.push({ ...source, revisions });
  }

  return { sources };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSourceKind(value: unknown): boolean {
  return value === "markdown" || value === "pdf" || value === "document" || value === "web";
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
