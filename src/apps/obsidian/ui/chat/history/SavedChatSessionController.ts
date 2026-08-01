import { SaveChatInput, SavedChat, SavedChatSummary } from "@core/chat/savedChat";

export interface SavedChatSessionControllerOptions {
  listSavedChats(): Promise<SavedChatSummary[]>;
  loadSavedChat(id: string): Promise<SavedChat | null>;
  saveChat(input: SaveChatInput): Promise<SavedChat>;
  renameSavedChat(id: string, title: string): Promise<void>;
  deleteSavedChat(id: string): Promise<void>;
  createSaveInput(): Omit<SaveChatInput, "id" | "createdAt"> | null;
}

/** Owns persisted-chat identity and keeps the saved-chat summary list in sync. */
export class SavedChatSessionController {
  private currentId: string | null = null;
  private currentCreatedAt: string | null = null;
  private summaries: SavedChatSummary[] = [];

  constructor(private readonly options: SavedChatSessionControllerOptions) {}

  get currentChatId(): string | null {
    return this.currentId;
  }

  get currentChatCreatedAt(): string | null {
    return this.currentCreatedAt;
  }

  get savedChats(): SavedChatSummary[] {
    return this.summaries;
  }

  async refresh(): Promise<void> {
    this.summaries = await this.options.listSavedChats();
  }

  async saveCurrent(): Promise<void> {
    const input = this.options.createSaveInput();
    if (!input) {
      return;
    }

    const saved = await this.options.saveChat({
      ...input,
      id: this.currentId ?? undefined,
      createdAt: this.currentCreatedAt ?? undefined,
    });
    this.currentId = saved.id;
    this.currentCreatedAt = saved.createdAt;
    await this.refresh();
  }

  async load(id: string): Promise<SavedChat | null> {
    await this.saveCurrent();
    const chat = await this.options.loadSavedChat(id);
    if (!chat) {
      return null;
    }

    this.currentId = chat.id;
    this.currentCreatedAt = chat.createdAt;
    return chat;
  }

  clearCurrent(): void {
    this.currentId = null;
    this.currentCreatedAt = null;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.options.renameSavedChat(id, title);
    await this.refresh();
  }

  async delete(id: string): Promise<boolean> {
    await this.options.deleteSavedChat(id);
    const wasCurrent = this.currentId === id;
    if (wasCurrent) {
      this.clearCurrent();
    }
    await this.refresh();
    return wasCurrent;
  }
}
