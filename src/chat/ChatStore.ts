import { mkdir, readFile, readdir, rename, writeFile } from "fs/promises";
import { basename, join } from "path";

import { ResearchAnswer } from "../shared/types";
import { ChatDisplayMessage } from "../ui/rendering";
import type { ResearchSearchMode } from "../research/ResearchService";

export interface SavedChatSettings {
  model: string;
  searchMode: ResearchSearchMode;
  deepResearch?: boolean;
}

export interface SavedChat {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatDisplayMessage[];
  lastAnswer: ResearchAnswer | null;
  attachedContextPaths: string[];
  chatSettings?: SavedChatSettings;
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
  chatSettings?: SavedChatSettings;
}

export interface FileChatStoreOptions {
  folder: string;
  now?: () => Date;
  createId?: () => string;
}

const CHAT_SCHEMA_VERSION = 1;
const SAFE_CHAT_ID = /^[a-zA-Z0-9_-]+$/;

export class FileChatStore {
  private readonly folder: string;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: FileChatStoreOptions) {
    this.folder = options.folder;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? createChatId;
  }

  async listChats(): Promise<SavedChatSummary[]> {
    await mkdir(this.folder, { recursive: true });
    const files = await readdir(this.folder);
    const summaries: SavedChatSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const id = basename(file, ".json");

      if (!isSafeChatId(id)) {
        continue;
      }

      const chat = await this.readChatFile(id);

      if (!chat) {
        continue;
      }

      summaries.push({
        id: chat.id,
        title: chat.title,
        updatedAt: chat.updatedAt,
        messageCount: chat.messages.length,
      });
    }

    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async loadChat(id: string): Promise<SavedChat | null> {
    assertSafeChatId(id);
    await mkdir(this.folder, { recursive: true });
    return this.readChatFile(id);
  }

  async saveChat(input: SaveChatInput): Promise<SavedChat> {
    await mkdir(this.folder, { recursive: true });
    const now = this.now().toISOString();
    const id = input.id ?? this.createId();
    assertSafeChatId(id);
    const existing = await this.readChatFile(id);
    const createdAt = input.createdAt ?? existing?.createdAt ?? now;
    const chat: SavedChat = {
      schemaVersion: CHAT_SCHEMA_VERSION,
      id,
      title: normalizeTitle(input.title ?? inferChatTitle(input.messages)),
      createdAt,
      updatedAt: now,
      messages: input.messages,
      lastAnswer: input.lastAnswer,
      attachedContextPaths: [...input.attachedContextPaths],
      ...(input.chatSettings ? { chatSettings: input.chatSettings } : {}),
    };

    await writeJsonAtomically(this.chatPath(id), chat);
    return chat;
  }

  private async readChatFile(id: string): Promise<SavedChat | null> {
    try {
      const raw = await readFile(this.chatPath(id), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return isSavedChat(parsed) ? parsed : null;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private chatPath(id: string): string {
    return join(this.folder, `${id}.json`);
  }
}

export function inferChatTitle(messages: ChatDisplayMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();

  if (!firstUserMessage) {
    return "Untitled chat";
  }

  const singleLine = firstUserMessage.replace(/\s+/g, " ");
  return singleLine.length <= 80 ? singleLine : `${singleLine.slice(0, 77)}...`;
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
    (chat.lastAnswer === null || typeof chat.lastAnswer === "object") &&
    (chat.chatSettings === undefined || isSavedChatSettings(chat.chatSettings))
  );
}

function isSavedChatSettings(value: unknown): value is SavedChatSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const settings = value as Partial<SavedChatSettings>;
  return (
    typeof settings.model === "string" &&
    (settings.searchMode === "indexOnly" ||
      settings.searchMode === "indexAndWeb" ||
      settings.searchMode === "webOnly") &&
    (settings.deepResearch === undefined || typeof settings.deepResearch === "boolean")
  );
}

function normalizeTitle(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  return normalized || "Untitled chat";
}

function createChatId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `chat-${Date.now().toString(36)}-${random}`;
}

function assertSafeChatId(id: string): void {
  if (!isSafeChatId(id)) {
    throw new Error(`Unsafe chat id: ${id}`);
  }
}

function isSafeChatId(id: string): boolean {
  return SAFE_CHAT_ID.test(id);
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
