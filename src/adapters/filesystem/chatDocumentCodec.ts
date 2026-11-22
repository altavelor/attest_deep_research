import type { ChatFileBaseline } from "@application/ports";
import { parseSavedChat, type SavedChat } from "@core/chat/savedChat";
import type { SubAgentStateSnapshot } from "@core/research";

export type ChatSections = Map<string, string>;

export interface ChatDocument {
  text: string;
  sections: ChatSections;
  chat: SavedChat;
  base: ChatFileBaseline;
}

const SUB_AGENTS = "subAgents";
const CHAT_FIELDS = [
  "schemaVersion",
  "id",
  "title",
  "createdAt",
  "updatedAt",
  "messages",
  "lastAnswer",
  "attachedContextPaths",
  "chatSettings",
  "sourceRegistry",
  "unreadCompletion",
  "isFavorite",
  "lastRun",
  "subAgentDispatches",
  "subAgentNotices",
  "timelineSequence",
] as const;
const snapshotTexts = new WeakMap<SubAgentStateSnapshot, string>();

/** Parses a chat file into per-field section texts, or returns null when it is not a readable chat. */
export function decodeChatDocument(text: string): ChatDocument | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const chat = parseSavedChat(value);
  if (!chat) return null;
  const sections: ChatSections = new Map();
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (key !== "recoveredFrom" && field !== undefined) sections.set(key, JSON.stringify(field));
  }
  return { text, sections, chat, base: baselineOf(chat, sections) };
}

/** Replaces every chat field section with the given chat, keeping unknown fields and the sub-agent section. */
export function withChatSections(sections: ChatSections, chat: SavedChat): ChatSections {
  const next = new Map(sections);
  const fields = chat as unknown as Record<string, unknown>;
  for (const key of CHAT_FIELDS) {
    if (fields[key] === undefined) next.delete(key);
    else next.set(key, JSON.stringify(fields[key]));
  }
  return next;
}

/** Sets the sub-agent section, serializing each immutable snapshot object only once. */
export function withSubAgentSection(
  sections: ChatSections,
  snapshot: SubAgentStateSnapshot,
): ChatSections {
  let text = snapshotTexts.get(snapshot);
  if (text === undefined) {
    text = JSON.stringify(snapshot);
    snapshotTexts.set(snapshot, text);
  }
  return new Map(sections).set(SUB_AGENTS, text);
}

/** Joins sections into compact JSON: chat fields in fixed order, unknown fields, then the sub-agent section. */
export function encodeChatDocument(sections: ChatSections): string {
  const known = new Set<string>([...CHAT_FIELDS, SUB_AGENTS]);
  const keys = [
    ...CHAT_FIELDS.filter((key) => sections.has(key)),
    ...[...sections.keys()].filter((key) => !known.has(key)),
    ...(sections.has(SUB_AGENTS) ? [SUB_AGENTS] : []),
  ];
  return `{${keys.map((key) => `${JSON.stringify(key)}:${sections.get(key)}`).join(",")}}\n`;
}

const TIMELINE_FIELDS = ["subAgentDispatches", "subAgentNotices", "timelineSequence"] as const;

function emptyTimelineText(text: string | undefined): string {
  return text === undefined || text === "[]" || text === "0" ? "" : text;
}

/** Builds the conflict token: the normalized content and timeline fields and the raw sub-agent section text. */
export function baselineOf(chat: SavedChat, sections: ChatSections): ChatFileBaseline {
  return {
    content: JSON.stringify([
      chat.messages,
      chat.lastAnswer,
      chat.attachedContextPaths,
      chat.chatSettings,
      chat.sourceRegistry,
      ...TIMELINE_FIELDS.map((key) => emptyTimelineText(sections.get(key))),
    ]),
    subAgents: sections.get(SUB_AGENTS) ?? "",
  };
}
