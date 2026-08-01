import { ContextDiagnostics } from "@core/diagnostics";
import { ResearchStreamEvent } from "@application/contracts/research";

export interface AgentRunDiagnosticCollectorOptions {
  runId: string;
  answerId: string;
  now?: () => number;
  timelineLimit?: number;
}

export class AgentRunDiagnosticCollector {
  private readonly now: () => number;
  private readonly timelineLimit: number;
  private readonly startedAtMs: number;
  private readonly timeline: Array<{
    offsetMs: number;
    type: string;
    round?: number;
    status?: string;
  }> = [];
  private omittedTimelineEvents = 0;
  private readonly reasoningSegments = new Set<string>();
  private readonly checkpoints = new Set<string>();
  private bufferedTextChars = 0;
  private finalTextChars = 0;
  private finalCommitted = false;
  private uiPatches = 0;
  private markdownRenders = 0;
  private coalescedUpdates = 0;

  constructor(private readonly options: AgentRunDiagnosticCollectorOptions) {
    this.now = options.now ?? Date.now;
    this.timelineLimit = options.timelineLimit ?? 500;
    this.startedAtMs = this.now();
    this.push("run.started");
  }

  record(event: ResearchStreamEvent): void {
    if (event.type === "reasoning") {
      this.reasoningSegments.add(event.segmentId);
      this.push("reasoning.delta");
      this.uiPatches += 1;
    } else if (event.type === "checkpoint-delta") {
      this.checkpoints.add(event.checkpointId);
      this.bufferedTextChars += event.content.length;
      this.push("checkpoint.delta", event.round);
      this.uiPatches += 1;
    } else if (event.type === "checkpoint-complete") {
      this.push("checkpoint.completed", event.round);
      this.uiPatches += 1;
    } else if (event.type === "checkpoint-promote") {
      this.finalCommitted = true;
      this.push("checkpoint.promoted", event.round);
      this.uiPatches += 1;
    } else if (event.type === "delta") {
      this.finalTextChars += event.content.length;
      this.finalCommitted = true;
      this.push("answer.delta");
      this.uiPatches += 1;
    } else if (event.type === "status") {
      this.push("status.changed");
    } else if (event.type === "answer-reset") {
      this.push("answer.reset");
      this.uiPatches += 1;
    } else if (event.type === "complete") {
      this.push("answer.completed", undefined, "success");
    }
  }

  /** A streaming update flushed to the DOM (one actual markdown render). */
  recordMarkdownRender(): void {
    this.markdownRenders += 1;
  }

  /** A streaming update that rode along on an already-scheduled render (no extra render). */
  recordCoalescedUpdate(): void {
    this.coalescedUpdates += 1;
  }

  complete(diagnostics: ContextDiagnostics): void {
    const completedAt = this.now();
    this.push("run.completed", undefined, "success");
    diagnostics.reportSchemaVersion = 2;
    diagnostics.run = {
      runId: this.options.runId,
      answerId: this.options.answerId,
      status: "completed",
      startedAt: new Date(this.startedAtMs).toISOString(),
      durationMs: Math.max(0, completedAt - this.startedAtMs),
      lastPhase: "persistence",
      timeline: [...this.timeline],
      ...(this.omittedTimelineEvents > 0
        ? { omittedTimelineEvents: this.omittedTimelineEvents }
        : {}),
    };
    diagnostics.projection = {
      reasoningSegments: this.reasoningSegments.size,
      checkpointsCreated: this.checkpoints.size,
      finalAnswersCommitted: this.finalCommitted ? 1 : 0,
      bufferedTextChars: this.bufferedTextChars,
      staleEventsIgnored: 0,
      duplicateDeltasIgnored: 0,
      classifications: [],
    };
    const renderInstrumented = this.markdownRenders + this.coalescedUpdates > 0;
    diagnostics.delivery = {
      projectorEventsReceived: this.uiPatches,
      uiPatchesApplied: this.uiPatches,
      coalescedUpdates: renderInstrumented ? this.coalescedUpdates : 0,
      markdownRenders: renderInstrumented ? this.markdownRenders : this.uiPatches,
      staleRunEventsIgnored: 0,
      persistenceStatus: "not-requested",
    };
    if (diagnostics.reasoning) {
      diagnostics.stream ??= {
        protocol: diagnostics.reasoning.protocol,
        protocolSource:
          diagnostics.reasoning.capabilitySource === "probe"
            ? "probe"
            : diagnostics.reasoning.capabilitySource === "observed"
              ? "cache"
              : "profile",
        observedDialects: diagnostics.reasoning.observedFormats ?? [],
        frameCount: 0,
        malformedFrameCount: 0,
        ignoredEventCount: 0,
        reasoningDeltaCount: this.reasoningSegments.size,
        textDeltaCount: this.finalTextChars > 0 ? 1 : 0,
        toolDeltaCount: diagnostics.tools.length,
        synthesizedStartCount: 0,
        synthesizedEndCount: 0,
        aliasConflictCount: 0,
        terminalEventObserved: true,
        doneMarkerObserved: true,
        warnings: [],
      };
    }
  }

  private push(type: string, round?: number, status?: string): void {
    const event = {
      offsetMs: Math.max(0, this.now() - this.startedAtMs),
      type,
      ...(round !== undefined ? { round } : {}),
      ...(status ? { status } : {}),
    };
    if (this.timeline.length >= this.timelineLimit) {
      this.timeline.shift();
      this.omittedTimelineEvents += 1;
    }
    this.timeline.push(event);
  }
}
