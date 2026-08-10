import { ChatRepository, FileSystemPort } from "@application/ports";
import { joinVaultPath, vaultBasename } from "@shared";
import {
  CHAT_SCHEMA_VERSION,
  SaveChatInput,
  SavedChat,
  SavedChatSummary,
  inferChatTitle,
  isSafeChatId,
  isSavedChat,
  normalizeTitle,
} from "@core/chat/savedChat";

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
      const chat: SavedChat = {
        schemaVersion: CHAT_SCHEMA_VERSION,
        id,
        title: normalizeTitle(input.title ?? inferChatTitle(input.messages)),
        createdAt,
        updatedAt: now,
        messages: input.messages,
        lastAnswer: input.lastAnswer,
        attachedContextPaths: [...input.attachedContextPaths],
        chatSettings: input.chatSettings,
        isFavorite: existing?.isFavorite === true,
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

  async deleteChat(id: string): Promise<void> {
    assertSafeChatId(id);

    await this.mutateChat(id, async () => {
      const path = this.chatPath(id);

      if (await this.fileSystem.exists(path)) {
        await this.fileSystem.remove(path);
      }
    });
  }

  private async readChatFile(id: string): Promise<SavedChat | null> {
    const path = this.chatPath(id);

    if (!(await this.fileSystem.exists(path))) {
      return null;
    }

    try {
      const parsed = JSON.parse(await this.fileSystem.readText(path)) as unknown;
      return isSavedChat(parsed) ? parsed : null;
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
