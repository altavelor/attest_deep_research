import { SavedChat, SavedChatSummary } from "@core/chat/savedChat";

export interface SavedChatSessionControllerOptions {
  listSavedChats(): Promise<SavedChatSummary[]>;
  loadSavedChat(id: string): Promise<SavedChat | null>;
  renameSavedChat(id: string, title: string): Promise<void>;
  setSavedChatFavorite(id: string, isFavorite: boolean): Promise<void>;
}

/** Keeps the saved-chat summary list in sync with the repository. */
export class SavedChatSessionController {
  private summaries: SavedChatSummary[] = [];

  constructor(private readonly options: SavedChatSessionControllerOptions) {}

  get savedChats(): SavedChatSummary[] {
    return this.summaries;
  }

  async refresh(): Promise<void> {
    this.summaries = await this.options.listSavedChats();
  }

  async load(id: string): Promise<SavedChat | null> {
    return this.options.loadSavedChat(id);
  }

  async rename(id: string, title: string): Promise<void> {
    await this.options.renameSavedChat(id, title);
    await this.refresh();
  }

  async setFavorite(id: string, isFavorite: boolean): Promise<void> {
    await this.options.setSavedChatFavorite(id, isFavorite);
    await this.refresh();
  }
}
