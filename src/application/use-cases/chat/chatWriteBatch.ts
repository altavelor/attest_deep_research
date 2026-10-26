import type { SaveChatInput } from "@core/chat/savedChat";
import {
  applySubAgentDelta,
  emptySubAgentState,
  evictSubAgentDetails,
  type SubAgentBufferedValue,
  type SubAgentStateSnapshot,
} from "@core/research";

export interface PendingDelta {
  revision: number;
  firstRevision: number;
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
