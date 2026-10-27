import type {
  SubAgentInspectionDetail,
  SubAgentInspectionSnapshot,
  SubAgentSessionCard,
} from "@application/contracts/subAgentInspection";
import type { SubAgentInspectionPort, SubAgentUserStopResult } from "@application/ports/subAgent";
import type { SubAgentRunSummary, SubAgentWorkflowItem } from "@core/research";
import { AT, sourcePolicy } from "./subAgentSessions";

type Reply<T> = () => Promise<T>;

/**
 * Scoped inspection port of one chat for UI tests. Each read and stop answers through a
 * replaceable reply, so a test can hold it behind a deferred gate; snapshots reach the
 * subscribers only when the test emits them.
 */
export class FakeInspectionPort implements SubAgentInspectionPort {
  readonly listeners = new Set<(snapshot: SubAgentInspectionSnapshot) => void>();
  readonly details = new Map<string, SubAgentInspectionDetail>();
  readonly stopCalls: [string, string | null][] = [];
  readonly sessionCalls: string[] = [];
  current: SubAgentInspectionSnapshot = inspectionSnapshot([]);
  snapshotReply: Reply<SubAgentInspectionSnapshot> = async () => this.current;
  sessionReply: ((sessionId: string) => Promise<SubAgentInspectionDetail | null>) | null = null;
  stopReply: Reply<SubAgentUserStopResult> = async () => "stopped";

  snapshot(): Promise<SubAgentInspectionSnapshot> {
    return this.snapshotReply();
  }

  getSession(sessionId: string): Promise<SubAgentInspectionDetail | null> {
    this.sessionCalls.push(sessionId);
    if (this.sessionReply) return this.sessionReply(sessionId);
    return Promise.resolve(this.details.get(sessionId) ?? null);
  }

  subscribe(listener: (snapshot: SubAgentInspectionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stopFromUser(sessionId: string, expectedRunId: string | null): Promise<SubAgentUserStopResult> {
    this.stopCalls.push([sessionId, expectedRunId]);
    return this.stopReply();
  }

  /** Replaces the current snapshot and details, then notifies every subscriber. */
  emit(snapshot: SubAgentInspectionSnapshot, details: SubAgentInspectionDetail[] = []): void {
    this.current = snapshot;
    for (const detail of details) this.details.set(detail.card.sessionId, detail);
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

export function sessionCard(
  sessionId: string,
  overrides: Partial<SubAgentSessionCard> = {},
): SubAgentSessionCard {
  return {
    sessionId,
    parentRunId: "parent-1",
    description: `Task ${sessionId}`,
    revision: 1,
    status: "ready",
    model: { profileId: "profile", providerId: "provider", modelId: "m-1", label: "Model One" },
    usage: {
      totalTokens: 1200,
      requestCount: 1,
      modelRounds: 1,
      toolCalls: 0,
      durationMs: 0,
      source: "provider",
    },
    usageIncomplete: false,
    elapsedMs: 65_000,
    updatedAt: AT,
    canStop: false,
    controlRunId: null,
    ...overrides,
  };
}

export function inspectionSnapshot(
  sessions: SubAgentSessionCard[],
  overrides: Partial<SubAgentInspectionSnapshot> = {},
): SubAgentInspectionSnapshot {
  return {
    revision: 1,
    activeCount: sessions.filter((card) => card.status === "running").length,
    hasAgentRuns: sessions.length > 0,
    sessions,
    ...overrides,
  };
}

export function runSummary(
  runId: string,
  sessionId: string,
  overrides: Partial<SubAgentRunSummary> = {},
): SubAgentRunSummary {
  return {
    subAgentRunId: runId,
    subAgentSessionId: sessionId,
    parentRunId: "parent-1",
    callerMode: "thinking",
    command: "initial",
    origin: "direct",
    attempt: 1,
    resultRevision: 0,
    status: "completed",
    phase: null,
    startedAt: AT,
    completedAt: AT,
    evidenceCount: 0,
    usage: { requestCount: 0, modelRounds: 0, toolCalls: 0, durationMs: 0, source: "provider" },
    terminalReason: null,
    resultSummary: null,
    effectiveSourcePolicy: sourcePolicy(),
    retryOfRunId: null,
    continuedFromRunId: null,
    budgetScopeId: null,
    ...overrides,
  } as SubAgentRunSummary;
}

export function workItem(
  id: string,
  runId: string,
  sequence: number,
  overrides: Partial<SubAgentWorkflowItem> = {},
): SubAgentWorkflowItem {
  return {
    id,
    sessionId: "s1",
    runId,
    name: "search_web",
    label: "Search the web",
    sequence,
    round: 1,
    status: "complete",
    startedAt: AT,
    payloadState: "captured",
    ...overrides,
  };
}
