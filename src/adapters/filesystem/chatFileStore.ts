import type { FileSystemPort } from "@application/ports";
import { joinVaultPath } from "@shared";
import { decodeChatDocument, type ChatDocument } from "./chatDocumentCodec";

export interface CurrentChatDocument {
  document: ChatDocument;
  recovered: boolean;
}

const CACHE_LIMIT = 4;

/**
 * Reads and replaces the files of one chat folder: the main file, its orphaned
 * temp copy and the previous generation. It keeps the last decoded documents so
 * an unchanged file is not parsed again, and never caches more than a few chats.
 */
export class ChatFileStore {
  private readonly cache = new Map<string, ChatDocument>();

  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly folder: string,
  ) {}

  mainPath(id: string): string {
    return joinVaultPath(this.folder, `${id}.json`);
  }

  /** Reads the main file, falling back to the previous generation when the main file is unreadable. */
  async readCurrent(id: string): Promise<CurrentChatDocument | null> {
    const main = this.mainPath(id);
    if (!(await this.fileSystem.exists(main))) return null;
    const document = await this.readDocument(main);
    if (document) return { document, recovered: false };
    const previous = await this.readOptional(`${main}.prev`);
    return previous ? { document: previous, recovered: true } : null;
  }

  /** Resolves a temp file left by an interrupted write so a confirmed chat never lives only in it. */
  async recoverOrphanTemp(id: string): Promise<void> {
    const main = this.mainPath(id);
    const temp = `${main}.tmp`;
    if (!(await this.fileSystem.exists(temp))) return;
    const mainExists = await this.fileSystem.exists(main);
    if (mainExists && !(await this.readDocument(main)) && (await this.readDocument(temp))) {
      await this.fileSystem.rename(temp, main);
      return;
    }
    await this.fileSystem.remove(temp);
  }

  /** Writes the text through a temp file and an atomic replace, removing the temp file on failure. */
  async replace(id: string, text: string, previousText: string | null): Promise<void> {
    const main = this.mainPath(id);
    if (previousText !== null) await this.fileSystem.writeText(`${main}.prev`, previousText);
    const temp = `${main}.tmp`;
    try {
      await this.fileSystem.writeText(temp, text);
      await this.fileSystem.rename(temp, main);
    } catch (error) {
      await this.fileSystem.remove(temp).catch(() => undefined);
      throw error;
    }
  }

  remember(id: string, document: ChatDocument): void {
    this.store(this.mainPath(id), document);
  }

  private store(path: string, document: ChatDocument): void {
    this.cache.delete(path);
    this.cache.set(path, document);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Removes the main file with its replace backup, then the temp and previous copies, and forgets the cache. */
  async remove(id: string): Promise<void> {
    const main = this.mainPath(id);
    this.cache.delete(main);
    await this.fileSystem.removeReplaceable(main);
    for (const path of [`${main}.tmp`, `${main}.prev`]) {
      if (await this.fileSystem.exists(path)) await this.fileSystem.remove(path);
    }
  }

  private async readOptional(path: string): Promise<ChatDocument | null> {
    return (await this.fileSystem.exists(path)) ? this.readDocument(path) : null;
  }

  private async readDocument(path: string): Promise<ChatDocument | null> {
    const text = await this.fileSystem.readText(path);
    const cached = this.cache.get(path);
    if (cached?.text === text) return cached;
    const document = decodeChatDocument(text);
    if (document && path.endsWith(".json")) this.store(path, document);
    return document;
  }
}
