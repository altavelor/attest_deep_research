import type { MapSourcesBatchRecord } from "../mapSourcesOutput";
import type {
  ImportedSubAgentEvidenceReference,
  SubAgentCreateRecord,
  SubAgentSessionRecord,
  SubAgentSubmissionRecord,
} from "./sessionModel";

export type ValidatedJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ValidatedJsonValue[]
  | { readonly [key: string]: ValidatedJsonValue };

export type SubAgentImportState = "prepared" | "committed" | "tombstoned";

export interface SubAgentImportRecord {
  state: SubAgentImportState;
  importId: string;
  chatId: string;
  sessionId: string;
  runId: string;
  evidenceDigest: string;
  generation: number;
  evidence: readonly ValidatedJsonValue[];
  aliases: readonly ImportedSubAgentEvidenceReference[];
  answerText: string;
  createdAt: string;
  tombstoneReason?: string;
  evidenceBudgetExhausted?: boolean;
}

export type SubAgentPendingActionState =
  "prepared" | "reserved" | "started" | "settled" | "unknown";

export interface SubAgentPendingAction {
  state: SubAgentPendingActionState;
  actionKey: string;
  sessionId: string;
  runId: string;
  attempt: number;
  action: string;
  ordinal: number;
  fenceGeneration: number;
  permit?: ValidatedJsonValue;
  outcome?: ValidatedJsonValue;
}

export type SubAgentObservationKind =
  "model-started" | "usage" | "tool-start" | "tool-end" | "phase";

export interface SubAgentEvictionMarker {
  reason: "chat size limit";
}

export interface SubAgentObservationRecord {
  kind: SubAgentObservationKind;
  observationId: string;
  sessionId: string;
  runId: string;
  cited: boolean;
  payload: ValidatedJsonValue;
  evicted?: SubAgentEvictionMarker;
}

export interface SubAgentRecoveryMarker {
  parentRunId: string;
  terminalReason: string;
  createdAt: string;
  fencedRunIds: readonly string[];
  cancelledImports: readonly { importId: string; generation: number }[];
  unresolvedActionKeys: readonly string[];
}

export interface SubAgentStateSnapshot {
  version: 1;
  chatId: string;
  revision: number;
  records: readonly SubAgentSessionRecord[];
  creates: readonly SubAgentCreateRecord[];
  submissions: readonly SubAgentSubmissionRecord[];
  imports: readonly SubAgentImportRecord[];
  pendingActions: readonly SubAgentPendingAction[];
  recoveryMarkers: readonly SubAgentRecoveryMarker[];
  observation: readonly SubAgentObservationRecord[];
  batches?: readonly MapSourcesBatchRecord[];
}

export type SubAgentStateEntity =
  | "session"
  | "run"
  | "create"
  | "submission"
  | "import"
  | "action"
  | "observation"
  | "batch"
  | "marker";

export type SubAgentBufferedValue =
  | {
      op: "set";
      entity: SubAgentStateEntity;
      id: string;
      fields: Readonly<Record<string, ValidatedJsonValue>>;
    }
  | { op: "delete"; entity: SubAgentStateEntity; id: string };

export type SubAgentFlushReason = "timer" | "size" | "count" | "barrier" | "dispose";

/** Returns the empty section state of a chat, used when the file has no sub-agent section yet. */
export function emptySubAgentState(chatId: string): SubAgentStateSnapshot {
  return {
    version: 1,
    chatId,
    revision: 0,
    records: [],
    creates: [],
    submissions: [],
    imports: [],
    pendingActions: [],
    recoveryMarkers: [],
    observation: [],
  };
}

/**
 * Returns the value as checked JSON, or undefined when it holds a non-finite number, a
 * cycle, a non-plain object, or nesting deeper than 64 levels. Only plain objects,
 * arrays, strings, finite numbers, booleans and null pass.
 */
export function toValidatedJson(value: unknown): ValidatedJsonValue | undefined {
  return checkJson(value, 0, new Set()) ? (value as ValidatedJsonValue) : undefined;
}

function checkJson(value: unknown, depth: number, seen: Set<object>): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || depth > 64 || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
  const valid = children.every((child) => checkJson(child, depth + 1, seen));
  seen.delete(value);
  return valid;
}
