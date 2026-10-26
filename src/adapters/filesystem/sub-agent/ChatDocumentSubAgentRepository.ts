import {
  ChatStorageError,
  type ChatRepository,
  type SubAgentSessionRepository,
} from "@application/ports";
import type { SubAgentStateSnapshot } from "@core/research";

/** Reads the sub-agent section of a chat file; writes go only through the chat write buffer. */
export class ChatDocumentSubAgentRepository implements SubAgentSessionRepository {
  constructor(private readonly chats: ChatRepository) {}

  async load(chatId: string): Promise<SubAgentStateSnapshot | null> {
    const section = (await this.chats.loadChat(chatId))?.subAgents;
    if (!section) return null;
    if (section.status === "unreadable") {
      throw new ChatStorageError("unreadable-section", section.reason);
    }
    return section.snapshot;
  }
}
