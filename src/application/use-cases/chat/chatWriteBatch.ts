import {
  ChatStorageError,
  type ChatDocumentChange,
  type ChatFileBaseline,
} from "@application/ports/chat";
import type { SaveChatInput } from "@core/chat/savedChat";
import {
  applySubAgentDelta,
  emptySubAgentState,
  evictSubAgentDetails,
  type SubAgentBufferedValue,
  type SubAgentStateSnapshot,
} from "@core/research";
import type { ChatSnapshotEntry } from "./chatWriteBufferTypes";

export interface PendingDelta {
  revision: number;
  firstRevision: number;
  firstStaged: number;
  value: SubAgentBufferedValue;
  bytes: number;
}

export interface AssembledSection {
  snapshot: SubAgentStateSnapshot | null;
  overGuard: boolean;
}

const chatChars = new WeakMap<SaveChatInput, number>();
const encoder = new TextEncoder();

/** Measures a delta as UTF-8 bytes of its serialized form. */
export function deltaBytes(value: SubAgentBufferedValue): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Applies pending deltas in revision order to the durable section and returns the
 * complete snapshot to write, or a null snapshot when a delta refers to a missing
 * entity. Details are evicted to the budget; when chat and section together reach
 * the file guard, every terminal detail is evicted and overGuard reports whether
 * the document is still at or above the guard.
 */
export function assembleSection(
  base: SubAgentStateSnapshot | null,
  chatId: string,
  deltas: readonly PendingDelta[],
  revisionFloor: number,
  chat: SaveChatInput | null,
  limits: { detailsBudget: number; fileGuardChars: number },
): AssembledSection {
  let snapshot: SubAgentStateSnapshot | null = base ?? emptySubAgentState(chatId);
  const ordered = [...deltas].sort((left, right) => left.revision - right.revision);
  for (const delta of ordered) {
    snapshot = applySubAgentDelta(snapshot, delta.value);
    if (!snapshot) return { snapshot: null, overGuard: false };
  }
  const revision = Math.max(snapshot.revision, revisionFloor, ...ordered.map((d) => d.revision));
  snapshot = evictSubAgentDetails({ ...snapshot, revision }, limits.detailsBudget).snapshot;
  const chatSize = chat ? measureChat(chat) : 0;
  if (chatSize + JSON.stringify(snapshot).length < limits.fileGuardChars) {
    return { snapshot, overGuard: false };
  }
  snapshot = evictSubAgentDetails(snapshot, 0).snapshot;
  return {
    snapshot,
    overGuard: chatSize + JSON.stringify(snapshot).length >= limits.fileGuardChars,
  };
}

function measureChat(chat: SaveChatInput): number {
  let size = chatChars.get(chat);
  if (size === undefined) {
    size = JSON.stringify(chat).length;
    chatChars.set(chat, size);
  }
  return size;
}

/**
 * Removes, in revision order, the pending deltas that no longer apply to a reloaded
 * section and returns how many were dropped. Applicable deltas stay pending.
 */
export function dropInapplicableDeltas(
  pending: Map<string, PendingDelta>,
  base: SubAgentStateSnapshot | null,
  chatId: string,
): number {
  let state = base ?? emptySubAgentState(chatId);
  let dropped = 0;
  const ordered = [...pending].sort(([, left], [, right]) => left.revision - right.revision);
  for (const [key, delta] of ordered) {
    const next = applySubAgentDelta(state, delta.value);
    if (next) {
      state = next;
    } else {
      pending.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

/** Builds the repository change for a batch: a first save binds the chat, later saves carry the baseline. */
export function chatDocumentChange(
  chatId: string | null,
  baseline: ChatFileBaseline | null,
  chat: ChatSnapshotEntry | null,
  subAgents: SubAgentStateSnapshot | undefined,
): ChatDocumentChange {
  if (chatId === null) return { chatId: null, chat: chat!.input };
  return {
    chatId,
    ...(baseline ? { base: baseline } : {}),
    ...(chat ? { chat: chat.input } : {}),
    ...(subAgents ? { subAgents } : {}),
  };
}

/** Keeps the oldest unacknowledged revision on entries that replaced a failed in-flight value. */
export function carryUnsentRevisions(
  currentChat: ChatSnapshotEntry | null,
  pending: ReadonlyMap<string, PendingDelta>,
  sentChat: ChatSnapshotEntry | null,
  sentDeltas: ReadonlyMap<string, PendingDelta>,
): void {
  if (sentChat && currentChat && currentChat !== sentChat) {
    currentChat.revision = Math.min(currentChat.revision, sentChat.revision);
  }
  for (const [key, sent] of sentDeltas) {
    const current = pending.get(key);
    if (current && current !== sent) {
      current.firstRevision = Math.min(current.firstRevision, sent.firstRevision);
      current.firstStaged = Math.min(current.firstStaged, sent.firstStaged);
    }
  }
}

/**
 * Tells whether an unsent delta keeps a waiter for a revision open. The chat and the sub-agent
 * store number their revisions separately, so a delta staged after the request may carry a
 * revision the waiter already holds; only deltas staged before the request hold it.
 */
export function holdsWaiter(delta: PendingDelta, revision: number, staged: number): boolean {
  return delta.firstRevision <= revision && delta.firstStaged <= staged;
}

/** Tells whether a buffered value starts new child work rather than updating existing work. */
export function isNewWork(payload: SubAgentBufferedValue): boolean {
  return payload.op === "set" && (payload.entity === "create" || payload.entity === "run");
}

/** The failure of every write after the chat was deleted. */
export function chatMissing(): ChatStorageError {
  return new ChatStorageError(
    "chat-missing",
    "The chat was deleted; nothing more is saved for it.",
  );
}
