import type {
  SubAgentBufferedValue,
  SubAgentFlushReason,
  SubAgentStateSnapshot,
} from "@core/research";

export interface SubAgentSessionRepository {
  load(chatId: string): Promise<SubAgentStateSnapshot | null>;
}

export interface SubAgentDurableWriter {
  markDirty(key: string, revision: number, payload: SubAgentBufferedValue): "accepted" | "full";
  flushThrough(revision: number, reason: SubAgentFlushReason): Promise<void>;
}
