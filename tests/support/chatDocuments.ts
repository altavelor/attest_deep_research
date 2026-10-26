import type {
  ChatDocumentChange,
  ChatDocumentCommit,
  ChatFileBaseline,
  ChatRepository,
  SavedChat,
  SaveChatInput,
} from "@application/ports";
import {
  emptySubAgentState,
  type SubAgentBufferedValue,
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

/** Builds a delta that sets fields of one session. */
export function sessionDelta(
  id: string,
  fields: Record<string, string | number> = { title: "Renamed" },
): SubAgentBufferedValue {
  return { op: "set", entity: "session", id, fields };
}

/**
 * Fake clock and timer scheduler for buffers: time moves only through advance,
 * which fires every due callback in order and lets their promises settle.
 */
export class ManualClock {
  private time = Date.parse("2026-10-26T10:00:00.000Z");
  private timers: { at: number; callback: () => void; cancelled: boolean }[] = [];

  readonly now = (): Date => new Date(this.time);

  readonly scheduleTimeout = (callback: () => void, delayMs: number): { cancel(): void } => {
    const timer = { at: this.time + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return { cancel: () => (timer.cancelled = true) };
  };

  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    for (;;) {
      await flushMicrotasks();
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at)[0];
      if (!due) break;
      due.cancelled = true;
      this.time = due.at;
      due.callback();
    }
    this.time = target;
    await flushMicrotasks();
  }

  pendingTimers(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }
}

/** Lets queued promise continuations run without touching any clock. */
async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
}

/**
 * Chat repository fake that records document commits. A test may queue failures,
 * hold the next commit until released, or set what loadChatDocument returns.
 */
export class ScriptedChatRepository implements ChatRepository {
  readonly commits: ChatDocumentChange[] = [];
  private failures: Error[] = [];
  private gate: Promise<void> | null = null;
  loaded: { chat: SavedChat; base: ChatFileBaseline } | null = null;

  failNext(...errors: Error[]): void {
    this.failures.push(...errors);
  }

  holdNext(): () => void {
    let release = (): void => {};
    this.gate = new Promise<void>((resolve) => (release = resolve));
    return release;
  }

  async commitChatDocument(change: ChatDocumentChange): Promise<ChatDocumentCommit> {
    this.commits.push(change);
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
    const failure = this.failures.shift();
    if (failure) throw failure;
    const id = change.chatId ?? "chat-created";
    return {
      chat: { id } as SavedChat,
      base: { content: `content-${this.commits.length}`, subAgents: "" },
      subAgentRevision: change.subAgents?.revision ?? null,
      written: true,
    };
  }

  async loadChatDocument(): Promise<{ chat: SavedChat; base: ChatFileBaseline } | null> {
    return this.loaded;
  }

  listChats(): never {
    throw new Error("unused");
  }
  loadChat(): never {
    throw new Error("unused");
  }
  saveChat(): never {
    throw new Error("unused");
  }
  renameChat(): never {
    throw new Error("unused");
  }
  setChatFavorite(): never {
    throw new Error("unused");
  }
  setChatUnreadCompletion(): never {
    throw new Error("unused");
  }
  setChatRunState(): never {
    throw new Error("unused");
  }
  deleteChat(): never {
    throw new Error("unused");
  }
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
