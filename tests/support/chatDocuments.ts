import type { SaveChatInput } from "@application/ports";
import {
  emptySubAgentState,
  type SubAgentSessionRecord,
  type SubAgentStateSnapshot,
} from "@core/research";
import { VaultFileSystem } from "@adapters/obsidian/VaultFileSystem";
import { MemoryDataAdapter } from "./obsidian";
import { readySubAgentRecord } from "./subAgentSessions";

export const DOCUMENT_CHAT_SETTINGS = {
  chatModelProfileId: "chat-model",
  searchMode: "indexOnly" as const,
};

/** Builds a chat snapshot as the session manager hands it to storage. */
export function chatInput(overrides: Partial<SaveChatInput> = {}): SaveChatInput {
  return {
    id: "chat-1",
    messages: [{ role: "user", content: "Question?", createdAt: "2026-10-26T10:00:00.000Z" }],
    lastAnswer: null,
    attachedContextPaths: [],
    chatSettings: DOCUMENT_CHAT_SETTINGS,
    ...overrides,
  };
}

/** Builds a valid sub-agent section of chat-1 holding the given session records. */
export function subAgentSection(
  records: readonly SubAgentSessionRecord[] = [readySubAgentRecord()],
  overrides: Partial<SubAgentStateSnapshot> = {},
): SubAgentStateSnapshot {
  return { ...emptySubAgentState("chat-1"), revision: 1, records, ...overrides };
}

/**
 * Data adapter that, like Obsidian's, refuses to rename onto an existing path. A
 * test can make the next rename or remove whose target ends with a suffix fail,
 * which interrupts a replace between its steps.
 */
class StrictDataAdapter extends MemoryDataAdapter {
  private failing: { method: "rename" | "remove"; suffix: string } | null = null;

  failNext(method: "rename" | "remove", suffix: string): void {
    this.failing = { method, suffix };
  }

  override async rename(fromPath: string, toPath: string): Promise<void> {
    this.trip("rename", toPath);
    if (await this.exists(toPath)) throw new Error(`Destination exists: ${toPath}`);
    await super.rename(fromPath, toPath);
  }

  override async remove(path: string): Promise<void> {
    this.trip("remove", path);
    await super.remove(path);
  }

  private trip(method: "rename" | "remove", path: string): void {
    if (this.failing?.method !== method || !path.endsWith(this.failing.suffix)) return;
    this.failing = null;
    throw new Error(`Interrupted ${method}: ${path}`);
  }
}

/** Builds a vault file system over a strict in-memory data adapter. */
export function strictVault(): { adapter: StrictDataAdapter; fileSystem: VaultFileSystem } {
  const adapter = new StrictDataAdapter();
  return { adapter, fileSystem: new VaultFileSystem(adapter as never) };
}
