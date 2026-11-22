import type { SubAgentRunRef } from "./subAgent/sessionModel";

export interface MatrixRow {
  sourcePath: string;
  ok: boolean;
  stance: string;
  keyFindings: string[];
  evidenceIds: string[];
  error?: string;
}

export interface MapSourcesOutput {
  question: string;
  rows: MatrixRow[];
  diagnostics: {
    selection: "explicit" | "relevance";
    requested: number;
    completed: number;
    failed: number;
  };
}

export type MapSourcesBatchRecordState =
  "preparing" | "pending" | "completed" | "failed" | "interrupted";

export interface MapSourcesBatchError {
  code: string;
  message: string;
}

export interface MapSourcesBatchRecord {
  batchId: string;
  parentRunId: string;
  requestId: string;
  normalizedInputDigest: string;
  question: string;
  createdAt: string;
  selection: "explicit" | "relevance";
  sourcePaths: readonly string[];
  refs: readonly { sourcePath: string; ref: SubAgentRunRef }[];
  state: MapSourcesBatchRecordState;
  result?: MapSourcesOutput;
  error?: MapSourcesBatchError;
}

export interface MapSourcesBatchReceipt {
  batchId: string;
  requested: number;
  refs: readonly SubAgentRunRef[];
}

export type MapSourcesBatchState =
  | { state: "pending"; batchId: string; completed: number; failed: number }
  | { state: "completed"; batchId: string; result: MapSourcesOutput }
  | { state: "failed" | "interrupted"; batchId: string; error: MapSourcesBatchError };

export const MAX_MAP_SOURCES_ROWS = 20;
export const MAX_MAP_SOURCES_QUESTION_CHARS = 1_000;
export const MAX_MAP_SOURCES_PATH_CHARS = 500;
export const MAX_MAP_SOURCES_ERROR_CHARS = 500;
export const MAX_MAP_SOURCES_FINDINGS = 4;
export const MAX_MAP_SOURCES_FINDING_CHARS = 400;
export const MAX_MAP_SOURCES_EVIDENCE_IDS = 12;
export const MAP_SOURCES_EVICTED_FINDING = "[evicted: chat size limit]";

const SAFE_ERROR_CODE = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** True for the batch states that never change again. */
export function isTerminalBatchState(state: MapSourcesBatchRecordState): boolean {
  return state === "completed" || state === "failed" || state === "interrupted";
}

/**
 * Builds the stored error text of one matrix row as "<code>: <text>" within 500
 * characters. The text must already be redacted; an unsafe code becomes "failed".
 */
export function mapSourcesRowError(code: string, redactedText: string): string {
  const safe = SAFE_ERROR_CODE.test(code) ? code : "failed";
  return `${safe}: ${redactedText}`.slice(0, MAX_MAP_SOURCES_ERROR_CHARS);
}

/** Builds a batch error with a safe code and a redacted message of at most 500 characters. */
export function mapSourcesBatchError(code: string, redactedText: string): MapSourcesBatchError {
  return {
    code: SAFE_ERROR_CODE.test(code) ? code : "failed",
    message: redactedText.slice(0, MAX_MAP_SOURCES_ERROR_CHARS),
  };
}

/** Maps a stored batch record to the state a result query returns; preparing reads as pending. */
export function mapSourcesBatchState(
  record: MapSourcesBatchRecord,
  counts: { completed: number; failed: number },
): MapSourcesBatchState {
  const { batchId } = record;
  if (record.state === "completed" && record.result) {
    return { state: "completed", batchId, result: record.result };
  }
  if (record.state === "failed" || record.state === "interrupted" || record.state === "completed") {
    return {
      state: record.state === "interrupted" ? "interrupted" : "failed",
      batchId,
      error: record.error ?? mapSourcesBatchError("batch-failed", "The batch did not finish."),
    };
  }
  return { state: "pending", batchId, ...counts };
}
