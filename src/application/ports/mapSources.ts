import type { SubAgentResultState, SubAgentRunReceipt, SubAgentRunRef } from "@core/research";
import type { SubAgentBatchStore, SubAgentMainEventSink } from "./subAgent";

export interface MapSourcesWorkerInput {
  requestId: string;
  task: string;
  sourcePath: string;
  maxRounds: number;
  maxResultChars: number;
  signal?: AbortSignal;
}

/** Starts one document worker of a map_sources batch as a child session and reads its result. */
export interface MapSourcesWorkerPort {
  runSource(input: MapSourcesWorkerInput): Promise<SubAgentRunReceipt>;
  getResult(ref: SubAgentRunRef): Promise<SubAgentResultState>;
}

/** What one parent run hands to map_sources: its workers, batch storage, notices and result signals. */
export interface MapSourcesRunContext {
  chatId: string;
  parentRunId: string;
  workers: MapSourcesWorkerPort;
  batches: SubAgentBatchStore;
  notices: SubAgentMainEventSink;
  subscribe(listener: () => void): () => void;
  now(): Date;
  redact(text: string): string;
}
