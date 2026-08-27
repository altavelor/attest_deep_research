import { ChatRepository, FileSystemPort } from "@application/ports";
import { joinVaultPath, vaultBasename } from "@shared";
import {
  CHAT_SCHEMA_VERSION,
  SaveChatInput,
  SavedChat,
  SavedChatSummary,
  inferChatTitle,
  isSafeChatId,
  normalizeTitle,
  parseSavedChat,
} from "@core/chat/savedChat";
import { createConversationSourceRegistry } from "@core/chat/sourceRegistry";
import type { SavedChatRunState } from "@core/chat/chatSession";

export interface FileChatRepositoryOptions {
  fileSystem: FileSystemPort;
  folder: string;
  now?: () => Date;
  createId?: () => string;
}

export class FileChatRepository implements ChatRepository {
  private static readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly fileSystem: FileSystemPort;
  private readonly folder: string;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: FileChatRepositoryOptions) {
    this.fileSystem = options.fileSystem;
    this.folder = options.folder;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? createChatId;
  }

  async listChats(): Promise<SavedChatSummary[]> {
    await this.fileSystem.createFolder(this.folder);
    const files = (await this.fileSystem.list(this.folder))
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.name);
    const summaries: SavedChatSummary[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const id = vaultBasename(file, ".json");

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
        messageCount: chat.messages.filter((message) => message.kind !== "compact-summary").length,
        isFavorite: chat.isFavorite === true,
        unreadCompletion: chat.unreadCompletion === true,
        ...(chat.lastRun ? { lastRun: chat.lastRun } : {}),
      });
    }

    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async loadChat(id: string): Promise<SavedChat | null> {
    assertSafeChatId(id);
    await this.fileSystem.createFolder(this.folder);
    return this.readChatFile(id);
  }

  async saveChat(input: SaveChatInput): Promise<SavedChat> {
    const id = input.id ?? this.createId();
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      const now = this.now().toISOString();
      const existing = await this.readChatFile(id);
      const createdAt = input.createdAt ?? existing?.createdAt ?? now;
      const lastRun = input.lastRun ?? existing?.lastRun;
      const chat: SavedChat = {
        schemaVersion: CHAT_SCHEMA_VERSION,
        id,
        title: normalizeTitle(input.title ?? inferChatTitle(input.messages)),
        createdAt,
        updatedAt: input.updatedAt ?? now,
        messages: input.messages,
        lastAnswer: input.lastAnswer,
        attachedContextPaths: [...input.attachedContextPaths],
        chatSettings: input.chatSettings,
        sourceRegistry:
          input.sourceRegistry ?? existing?.sourceRegistry ?? createConversationSourceRegistry(),
        unreadCompletion: input.unreadCompletion ?? existing?.unreadCompletion ?? false,
        isFavorite: existing?.isFavorite === true,
        ...(lastRun ? { lastRun } : {}),
      };

      await this.writeJsonAtomically(this.chatPath(id), chat);
      return chat;
    });
  }

  async renameChat(id: string, title: string): Promise<SavedChat | null> {
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      const existing = await this.readChatFile(id);

      if (!existing) {
        return null;
      }

      const chat: SavedChat = {
        ...existing,
        title: normalizeTitle(title),
        updatedAt: this.now().toISOString(),
      };
      await this.writeJsonAtomically(this.chatPath(id), chat);
      return chat;
    });
  }

  async setChatFavorite(id: string, isFavorite: boolean): Promise<SavedChat | null> {
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      const existing = await this.readChatFile(id);

      if (!existing) {
        return null;
      }

      const chat: SavedChat = { ...existing, isFavorite };
      await this.writeJsonAtomically(this.chatPath(id), chat);
      return chat;
    });
  }

  async setChatUnreadCompletion(id: string, unreadCompletion: boolean): Promise<SavedChat | null> {
    return this.patchChat(id, (existing) => ({ ...existing, unreadCompletion }));
  }

  async setChatRunState(id: string, lastRun: SavedChatRunState): Promise<SavedChat | null> {
    return this.patchChat(id, (existing) => ({ ...existing, lastRun }));
  }

  async deleteChat(id: string): Promise<void> {
    assertSafeChatId(id);

    await this.mutateChat(id, async () => {
      const path = this.chatPath(id);

      if (await this.fileSystem.exists(path)) {
        await this.fileSystem.remove(path);
      }
    });
  }

  /** Rewrites chat metadata without touching `updatedAt`, so history order stays stable. */
  private async patchChat(
    id: string,
    patch: (existing: SavedChat) => SavedChat,
  ): Promise<SavedChat | null> {
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      const existing = await this.readChatFile(id);

      if (!existing) {
        return null;
      }

      const chat = patch(existing);
      await this.writeJsonAtomically(this.chatPath(id), chat);
      return chat;
    });
  }

  private async readChatFile(id: string): Promise<SavedChat | null> {
    const path = this.chatPath(id);

    if (!(await this.fileSystem.exists(path))) {
      return null;
    }

    try {
      const parsed = JSON.parse(await this.fileSystem.readText(path)) as unknown;
      return parseSavedChat(parsed);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return null;
      }

      throw error;
    }
  }

  private chatPath(id: string): string {
    return joinVaultPath(this.folder, `${id}.json`);
  }

  private async writeJsonAtomically(path: string, value: unknown): Promise<void> {
    const tempPath = `${path}.tmp`;
    await this.fileSystem.writeText(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await this.fileSystem.rename(tempPath, path);
  }

  private async mutateChat<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const path = this.chatPath(id);
    const previous = FileChatRepository.mutationQueues.get(path) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    FileChatRepository.mutationQueues.set(path, settled);

    try {
      return await result;
    } finally {
      if (FileChatRepository.mutationQueues.get(path) === settled) {
        FileChatRepository.mutationQueues.delete(path);
      }
    }
  }
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
