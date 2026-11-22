import {
  ChatStorageError,
  type ChatDocumentChange,
  type ChatDocumentCommit,
  type ChatFileBaseline,
  type ChatRepository,
  type FileSystemPort,
} from "@application/ports";
import { vaultBasename } from "@shared";
import {
  CHAT_SCHEMA_VERSION,
  SaveChatInput,
  SavedChat,
  SavedChatSummary,
  inferChatTitle,
  isSafeChatId,
  normalizeTitle,
} from "@core/chat/savedChat";
import { createConversationSourceRegistry } from "@core/chat/sourceRegistry";
import { isTerminalChatSessionStatus, type SavedChatRunState } from "@core/chat/chatSession";
import { validateSubAgentState, type SubAgentStateSnapshot } from "@core/research";
import {
  baselineOf,
  encodeChatDocument,
  withChatSections,
  withSubAgentSection,
  type ChatDocument,
} from "./chatDocumentCodec";
import { ChatFileStore, type CurrentChatDocument } from "./chatFileStore";

export interface FileChatRepositoryOptions {
  fileSystem: FileSystemPort;
  folder: string;
  now?: () => Date;
  createId?: () => string;
}

/**
 * Stores each chat as one compact JSON file holding the chat and its optional
 * sub-agent section. Every mutation of a file runs in one queue shared by all
 * instances, replaces the file atomically and preserves the fields it does not own.
 */
export class FileChatRepository implements ChatRepository {
  private static readonly mutationQueues = new Map<string, Promise<void>>();
  private readonly fileSystem: FileSystemPort;
  private readonly folder: string;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly files: ChatFileStore;

  constructor(options: FileChatRepositoryOptions) {
    this.fileSystem = options.fileSystem;
    this.folder = options.folder;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? createChatId;
    this.files = new ChatFileStore(options.fileSystem, options.folder);
  }

  async listChats(): Promise<SavedChatSummary[]> {
    await this.fileSystem.createFolder(this.folder);
    const files = (await this.fileSystem.list(this.folder))
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => vaultBasename(entry.name, ".json"))
      .filter(isSafeChatId);
    const summaries: SavedChatSummary[] = [];

    for (const id of files) {
      const chat = (await this.files.readCurrent(id))?.document.chat;
      if (!chat) continue;
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
    return (await this.loadChatDocument(id))?.chat ?? null;
  }

  async loadChatDocument(id: string): Promise<{ chat: SavedChat; base: ChatFileBaseline } | null> {
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      await this.files.recoverOrphanTemp(id);
      const current = await this.files.readCurrent(id);
      if (!current) return null;
      const { chat, base } = current.document;
      return { chat: current.recovered ? { ...chat, recoveredFrom: "previous" } : chat, base };
    });
  }

  async saveChat(input: SaveChatInput): Promise<SavedChat> {
    const id = input.id ?? this.createId();
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      await this.files.recoverOrphanTemp(id);
      const current = await this.files.readCurrent(id);
      return (await this.write(id, current, input, undefined)).chat;
    });
  }

  async commitChatDocument(change: ChatDocumentChange): Promise<ChatDocumentCommit> {
    const creating = change.chatId === null;
    if (creating ? !change.chat || change.base : !change.base) {
      throw new Error("A chat document commit needs a baseline unless it creates the chat.");
    }
    const id = change.chatId ?? this.createId();
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      await this.files.recoverOrphanTemp(id);
      const current = await this.files.readCurrent(id);
      if (creating && current) throw new Error(`Chat id collision: ${id}`);
      if (!creating && !current) {
        throw new ChatStorageError("chat-missing", "The chat file no longer exists.");
      }
      if (current && change.base) assertBaseline(current.document, change);
      if (change.subAgents) assertWritableSection(id, current, change.subAgents);
      return this.write(id, current, change.chat, change.subAgents, change.base);
    });
  }

  async renameChat(id: string, title: string): Promise<SavedChat | null> {
    return this.patchChat(id, (existing) => ({
      ...existing,
      title: normalizeTitle(title),
      updatedAt: this.now().toISOString(),
    }));
  }

  async setChatFavorite(id: string, isFavorite: boolean): Promise<SavedChat | null> {
    return this.patchChat(id, (existing) => ({ ...existing, isFavorite }));
  }

  async setChatUnreadCompletion(id: string, unreadCompletion: boolean): Promise<SavedChat | null> {
    return this.patchChat(id, (existing) => ({ ...existing, unreadCompletion }));
  }

  async setChatRunState(id: string, lastRun: SavedChatRunState): Promise<SavedChat | null> {
    return this.patchChat(id, (existing) => ({ ...existing, lastRun }));
  }

  async deleteChat(id: string): Promise<void> {
    assertSafeChatId(id);
    await this.mutateChat(id, () => this.files.remove(id));
  }

  /** Rewrites chat metadata on the fresh file without a baseline check and without touching other sections. */
  private async patchChat(
    id: string,
    patch: (existing: SavedChat) => SavedChat,
  ): Promise<SavedChat | null> {
    assertSafeChatId(id);
    return this.mutateChat(id, async () => {
      await this.fileSystem.createFolder(this.folder);
      await this.files.recoverOrphanTemp(id);
      const current = await this.files.readCurrent(id);
      if (!current || current.recovered) return null;
      const chat = patch(current.document.chat);
      const sections = withChatSections(current.document.sections, chat);
      const document = {
        text: encodeChatDocument(sections),
        sections,
        chat,
        base: baselineOf(chat, sections),
      };
      await this.files.replace(id, document.text, null);
      this.files.remember(id, document);
      return chat;
    });
  }

  private async write(
    id: string,
    current: CurrentChatDocument | null,
    input: SaveChatInput | undefined,
    subAgents: SubAgentStateSnapshot | undefined,
    base?: ChatFileBaseline,
  ): Promise<ChatDocumentCommit> {
    const existing = current?.document;
    let chat = input ? this.buildChat(id, input, existing?.chat) : existing!.chat;
    let sections = withChatSections(existing?.sections ?? new Map(), chat);
    if (subAgents) {
      sections = withSubAgentSection(sections, subAgents);
      chat = { ...chat, subAgents: { status: "ready", snapshot: subAgents } };
    }
    const text = encodeChatDocument(sections);
    const fresh = baselineOf(chat, sections);
    const document: ChatDocument = { text, sections, chat, base: fresh };
    const written = current?.recovered !== false || existing?.text !== text;
    if (written) {
      const keepPrevious =
        current?.recovered === false &&
        input?.lastRun &&
        isTerminalChatSessionStatus(input.lastRun.status);
      await this.files.replace(id, text, keepPrevious ? existing!.text : null);
    }
    this.files.remember(id, document);
    return {
      chat,
      base: {
        content: input || !base ? fresh.content : base.content,
        subAgents: subAgents || !base ? fresh.subAgents : base.subAgents,
      },
      subAgentRevision: subAgents?.revision ?? null,
      written,
    };
  }

  private buildChat(id: string, input: SaveChatInput, existing: SavedChat | undefined): SavedChat {
    const now = this.now().toISOString();
    const lastRun = input.lastRun ?? existing?.lastRun;
    return {
      schemaVersion: CHAT_SCHEMA_VERSION,
      id,
      title: normalizeTitle(input.title ?? inferChatTitle(input.messages)),
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
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
      subAgentDispatches: input.subAgentDispatches ?? existing?.subAgentDispatches ?? [],
      subAgentNotices: input.subAgentNotices ?? existing?.subAgentNotices ?? [],
      timelineSequence: input.timelineSequence ?? existing?.timelineSequence ?? 0,
      ...(existing?.subAgents ? { subAgents: existing.subAgents } : {}),
    };
  }

  private async mutateChat<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const path = this.files.mainPath(id);
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

function assertBaseline(document: ChatDocument, change: ChatDocumentChange): void {
  const base = change.base!;
  if (
    (change.chat && document.base.content !== base.content) ||
    (change.subAgents && document.base.subAgents !== base.subAgents)
  ) {
    throw new ChatStorageError(
      "document-conflict",
      "The chat file was changed outside this window; reload it or keep this chat.",
    );
  }
}

function assertWritableSection(
  id: string,
  current: CurrentChatDocument | null,
  snapshot: SubAgentStateSnapshot,
): void {
  const section = current?.document.chat.subAgents;
  if (current?.recovered || section?.status === "unreadable") {
    throw new ChatStorageError(
      "unreadable-section",
      "The saved sub-agent state of this chat is unreadable and was left unchanged.",
    );
  }
  const validation = validateSubAgentState(snapshot);
  if (!validation.ok || snapshot.chatId !== id) {
    throw new ChatStorageError(
      "invalid-snapshot",
      `Sub-agent state was not saved: ${validation.ok ? "it belongs to another chat." : validation.message}`,
    );
  }
  if (section && section.snapshot.revision > snapshot.revision) {
    throw new ChatStorageError(
      "document-conflict",
      "A newer sub-agent state is already saved for this chat.",
    );
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
