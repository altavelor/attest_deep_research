import type { ApiFormat, ToolCallingCapabilities } from "@core/agent";
import type { ResearchStreamEvent } from "@application/contracts/research";
import type { ResearchStatePort } from "@application/ports/researchState";
import type {
  ContextDiagnostics,
  DeepResearchChildRunDiagnostic,
  DeepResearchTurnKind,
  ToolCallDiagnostic,
} from "@core/diagnostics";
import {
  boundDiagnosticText,
  deepResearchTurnDiagnostics,
  type BranchAllocation,
  type ResearchState,
  type ResearchWork,
} from "@core/research/deepResearch";
import { createEmptyContextDiagnostics } from "../strategies/ResearchDiagnostics";
import type { ResearchExecutionContext } from "../strategies/ResearchStrategy";
import type { BranchRunner } from "./branchRunner";

const MAX_TOOL_CALLS = 100;

export interface DeepResearchTurnModel {
  name: string;
  apiFormat?: ApiFormat;
  toolCapabilities: ToolCallingCapabilities;
}
const recorders = new WeakMap<ResearchExecutionContext, DeepResearchTurnRecorder>();

/** Returns the recorder of a turn context, present only when the request asked for diagnostics. */
export function turnRecorderOf(ctx: ResearchExecutionContext): DeepResearchTurnRecorder | null {
  return recorders.get(ctx) ?? null;
}

/**
 * Collects the diagnostics of one Deep Research turn through narrow observation points: committed
 * states, branch attempts and main-path tool events. It never stores finding or model text.
 */
export class DeepResearchTurnRecorder {
  private readonly before: ResearchState | null;
  private after: ResearchState | null = null;
  private readonly runs = new Map<string, DeepResearchChildRunDiagnostic[]>();
  private readonly tools = new Map<string, ToolCallDiagnostic>();
  private omittedTools = 0;
  private turnKind: DeepResearchTurnKind = "start";

  constructor(
    readonly ctx: ResearchExecutionContext,
    port: ResearchStatePort,
    private readonly model: DeepResearchTurnModel,
  ) {
    const view = port.read();
    this.before = view.status === "ready" ? view.active : null;
    recorders.set(ctx, this);
  }

  setTurnKind(kind: DeepResearchTurnKind): void {
    this.turnKind = kind;
  }

  /** Wraps the research state port so every committed state becomes the turn's latest state. */
  observePort(port: ResearchStatePort): ResearchStatePort {
    return {
      read: () => port.read(),
      commit: async (state, expectedRevision) => {
        const result = await port.commit(state, expectedRevision);
        this.after = state;
        return result;
      },
    };
  }

  /** Wraps a branch runner so each attempt records its measured usage and failure. */
  observeRunner<T extends BranchRunner>(runner: T): BranchRunner {
    const record = (work: ResearchWork, allocation: BranchAllocation, error?: unknown): void => {
      const usage = runner.usage?.(work.workId) ?? null;
      const child = runner.childRun?.(work.workId) ?? null;
      const entry: DeepResearchChildRunDiagnostic = {
        attempt: allocation.attempt,
        path: runner.path,
        rounds: usage?.modelRounds ?? null,
        searches: usage?.searches ?? null,
        evidenceItems: usage?.evidenceItems ?? null,
        allocatedRounds: allocation.modelRounds,
        allocatedSearches: allocation.searches,
        ...(child
          ? { childOutcome: boundDiagnosticText(child.outcome), childEvidence: child.evidenceCount }
          : {}),
        ...(error === undefined
          ? {}
          : { error: boundDiagnosticText(error instanceof Error ? error.message : String(error)) }),
      };
      this.runs.set(work.workId, [...(this.runs.get(work.workId) ?? []), entry]);
    };
    return {
      path: runner.path,
      run: async (work, allocation, signal) => {
        try {
          const finding = await runner.run(work, allocation, signal);
          record(work, allocation);
          return finding;
        } catch (error) {
          record(work, allocation, error);
          throw error;
        }
      },
      ...(runner.usage ? { usage: (workId: string) => runner.usage!(workId) } : {}),
      ...(runner.runRef ? { runRef: (workId: string) => runner.runRef!(workId) } : {}),
      ...(runner.childRun ? { childRun: (workId: string) => runner.childRun!(workId) } : {}),
    };
  }

  /** Records main-path tool calls of the turn; child tool calls carry a parent and are skipped. */
  observeEvent(event: ResearchStreamEvent): void {
    if (event.type === "tool-call-start" && event.parentId === undefined) {
      if (this.tools.size >= MAX_TOOL_CALLS) {
        this.omittedTools += 1;
        return;
      }
      this.tools.set(event.id, {
        id: boundDiagnosticText(event.id),
        name: boundDiagnosticText(event.name),
        status: "skipped",
        arguments: {},
        round: event.round,
      });
    }
    if (event.type === "tool-call-end") {
      const call = this.tools.get(event.id);
      if (call) {
        call.status = event.ok ? "success" : "failed";
        if (event.resultSummary) call.resultPreview = boundDiagnosticText(event.resultSummary);
      }
    }
  }

  diagnostics(): ContextDiagnostics {
    const diagnostics = createEmptyContextDiagnostics(
      this.ctx.request.contextMode ?? "include",
      "deep-research",
    );
    diagnostics.question = this.ctx.question;
    diagnostics.modelName = this.model.name;
    if (this.model.apiFormat) diagnostics.modelApiFormat = this.model.apiFormat;
    diagnostics.toolCapabilities = this.model.toolCapabilities;
    diagnostics.searchMode = this.ctx.searchMode;
    diagnostics.tools = [...this.tools.values()];
    if (this.omittedTools > 0) {
      diagnostics.warnings.push(`${this.omittedTools} main-path tool call(s) omitted.`);
    }
    diagnostics.deepResearch = deepResearchTurnDiagnostics({
      turnKind: this.turnKind,
      before: this.before,
      after: this.after,
      runs: this.runs,
    });
    return diagnostics;
  }
}

/**
 * Forwards the events of a turn to the recorder and attaches the turn's diagnostics to its
 * completed answer, so the assistant message carries them like a Thinking answer does.
 */
export async function* withTurnDiagnostics<R>(
  events: AsyncGenerator<ResearchStreamEvent, R>,
  recorder: DeepResearchTurnRecorder,
): AsyncGenerator<ResearchStreamEvent, R> {
  for (;;) {
    const next = await events.next();
    if (next.done) return next.value;
    const event = next.value;
    recorder.observeEvent(event);
    yield event.type === "complete"
      ? { ...event, answer: { ...event.answer, contextDiagnostics: recorder.diagnostics() } }
      : event;
  }
}
