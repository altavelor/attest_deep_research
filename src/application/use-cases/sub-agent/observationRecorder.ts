import {
  capRedactedText,
  findOwnRun,
  isSubAgentModelSnapshot,
  isSubAgentStateId,
  MAX_RUN_PAYLOAD_CHARS,
  sanitizeSubAgentPrompt,
  sanitizeSubAgentToolItem,
  type NormalizedUsage,
  type SubAgentObservationEvent,
  type SubAgentObservationRecord,
  type SubAgentWorkflowItem,
  type ValidatedJsonValue,
} from "@core/research";
import { timestamp, type SubAgentManagerParts } from "./managerParts";

type Row = Record<string, unknown>;

const USAGE_COUNTERS = ["requestCount", "modelRounds", "toolCalls", "durationMs"] as const;
const USAGE_TOKENS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "reasoningTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
] as const;
const MAX_PHASE_CHARS = 200;

/**
 * Turns the untrusted observation events of running children into the stored read
 * projection: the model and initial prompt of a run, per-request usage, tool items and
 * the current phase. Events of a fenced or finished run are dropped; everything is
 * redacted and bounded before it is staged, and the execution clock runs on a monotonic source.
 */
export class SubAgentObservationRecorder {
  private readonly starts = new Map<string, number>();
  private readonly payloadChars = new Map<string, number>();
  private readonly liveRevisions = new Map<string, number>();

  constructor(private readonly parts: SubAgentManagerParts) {}

  redact(text: string): string {
    return this.parts.context.redact ? this.parts.context.redact(text) : text;
  }

  begin(runId: string): void {
    this.starts.set(runId, this.monotonic());
  }

  /** Ends the execution clock of a run, drops its meters and returns the elapsed milliseconds. */
  finish(runId: string): number {
    const elapsed = this.elapsed(runId);
    this.starts.delete(runId);
    this.payloadChars.delete(runId);
    return elapsed;
  }

  elapsed(runId: string): number {
    const start = this.starts.get(runId);
    return start === undefined ? 0 : Math.max(0, Math.round(this.monotonic() - start));
  }

  liveRevision(sessionId: string): number {
    return this.liveRevisions.get(sessionId) ?? 0;
  }

  clear(): void {
    this.starts.clear();
    this.payloadChars.clear();
    this.liveRevisions.clear();
  }

  /** Returns the capture callback of one started run; it ignores events once the run is no longer live. */
  observer(sessionId: string, runId: string, isLive: () => boolean): (event: unknown) => void {
    return (event) => {
      try {
        if (!isLive() || typeof event !== "object" || event === null) return;
        if (!this.record(sessionId, runId, event as SubAgentObservationEvent)) return;
        this.liveRevisions.set(sessionId, this.liveRevision(sessionId) + 1);
        this.parts.notifyObservation();
      } catch {
        return;
      }
    };
  }

  private record(sessionId: string, runId: string, event: SubAgentObservationEvent): boolean {
    switch (event.type) {
      case "model-started":
        return event.runId === runId && this.modelStarted(sessionId, runId, event);
      case "usage":
        return event.runId === runId && this.usage(sessionId, runId, event);
      case "tool-start":
      case "tool-end":
        return this.tool(sessionId, runId, event.type, event.item);
      case "phase":
        return event.runId === runId && this.phase(sessionId, runId, event.phase);
      default:
        return false;
    }
  }

  private modelStarted(
    sessionId: string,
    runId: string,
    event: Extract<SubAgentObservationEvent, { type: "model-started" }>,
  ): boolean {
    const observationId = `model:${runId}`;
    if (this.existing(observationId) || !isSubAgentModelSnapshot(event.model)) return false;
    const model = {
      profileId: event.model.profileId,
      providerId: event.model.providerId,
      modelId: event.model.modelId,
      label: capRedactedText(this.redact(event.model.label), MAX_PHASE_CHARS).text,
    };
    const messages = Array.isArray(event.prompt?.messages) ? event.prompt.messages : [];
    const prompt = sanitizeSubAgentPrompt(runId, timestamp(this.parts), messages, (text) =>
      this.redact(text),
    );
    const record = this.parts.store.record(sessionId);
    if (!record || !findOwnRun(record, runId)) return false;
    this.parts.store.putRunModel(runId, model);
    this.put("model-started", observationId, sessionId, runId, { model, prompt });
    return true;
  }

  private usage(
    sessionId: string,
    runId: string,
    event: Extract<SubAgentObservationEvent, { type: "usage" }>,
  ): boolean {
    if (!isSubAgentStateId(event.requestId)) return false;
    const usage = cleanUsage(event.usage);
    if (!usage) return false;
    this.put("usage", `usage:${runId}:${event.requestId}`, sessionId, runId, {
      requestId: event.requestId,
      usage,
      final: event.final === true,
    });
    return true;
  }

  private tool(
    sessionId: string,
    runId: string,
    kind: "tool-start" | "tool-end",
    item: SubAgentWorkflowItem,
  ): boolean {
    if (!item || item.sessionId !== sessionId || item.runId !== runId) return false;
    if (!isSubAgentStateId(item.id)) return false;
    const observationId = `tool:${item.id}`;
    const previous = this.existing(observationId)?.payload as Row | null | undefined;
    if (kind === "tool-start" && previous && previous.status !== "pending") return false;
    const used = this.payloadChars.get(runId) ?? 0;
    const args = item.args ?? (previous?.args as SubAgentWorkflowItem["args"]);
    const capture = sanitizeSubAgentToolItem(args ? { ...item, args } : item, {
      redact: (text) => this.redact(text),
      debug: this.parts.context.isDebugCapture?.() === true,
      remainingRunChars: MAX_RUN_PAYLOAD_CHARS - used,
    });
    this.payloadChars.set(runId, used + capture.payloadChars);
    const sequence =
      typeof previous?.sequence === "number" ? previous.sequence : this.nextSequence(sessionId);
    const status =
      kind === "tool-start" ? "pending" : capture.item.status === "failed" ? "failed" : "complete";
    this.put(kind, observationId, sessionId, runId, { ...capture.item, status, sequence });
    return true;
  }

  private phase(sessionId: string, runId: string, phase: unknown): boolean {
    if (typeof phase !== "string") return false;
    this.put("phase", `phase:${runId}`, sessionId, runId, {
      phase: capRedactedText(this.redact(phase), MAX_PHASE_CHARS).text,
      occurredAt: timestamp(this.parts),
    });
    return true;
  }

  private nextSequence(sessionId: string): number {
    let last = 0;
    for (const entry of this.parts.store.state?.observation ?? []) {
      if (entry.sessionId !== sessionId || !entry.observationId.startsWith("tool:")) continue;
      const sequence = (entry.payload as Row | null)?.sequence;
      if (typeof sequence === "number" && sequence > last) last = sequence;
    }
    return last + 1;
  }

  private existing(observationId: string): SubAgentObservationRecord | undefined {
    return this.parts.store.state?.observation.find(
      (entry) => entry.observationId === observationId,
    );
  }

  private put(
    kind: SubAgentObservationRecord["kind"],
    observationId: string,
    sessionId: string,
    runId: string,
    payload: object,
  ): void {
    this.parts.store.putObservation({
      kind,
      observationId,
      sessionId,
      runId,
      cited: false,
      payload: payload as ValidatedJsonValue,
    });
  }

  private monotonic(): number {
    return this.parts.context.monotonicNow
      ? this.parts.context.monotonicNow()
      : this.parts.context.now().getTime();
  }
}

/** Keeps only reported finite nonnegative usage fields of an untrusted usage record. */
function cleanUsage(value: unknown): NormalizedUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Row;
  const usage: NormalizedUsage = {
    requestCount: 0,
    modelRounds: 0,
    toolCalls: 0,
    durationMs: 0,
    source: row.source === "provider" || row.source === "estimated" ? row.source : "unavailable",
  };
  for (const key of USAGE_COUNTERS) if (validCount(row[key])) usage[key] = row[key];
  for (const key of USAGE_TOKENS) if (validCount(row[key])) usage[key] = row[key];
  return usage;
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
