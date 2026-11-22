import {
  emptyBudgetState,
  initialExecutions,
  presetLimits,
  withPlanForReview,
  startResearchState,
  type ResearchBranch,
  type ResearchPlan,
  type ResearchPreset,
  type ResearchReport,
  type ResearchState,
  type ResearchTurnInput,
} from "@core/research/deepResearch";
import { ResearchService, type ResearchServiceOptions } from "@application/use-cases/research";
import type { ChatRunRequest } from "@application/use-cases/chat";
import { createResearchToolRegistry, runToolLoop } from "@adapters/research-tools";
import { ChatCompletionsRoundAdapter } from "@adapters/model-provider";
import { emptyRetrieval, fixedNow } from "./factories";
import { FakeRetriever } from "./researchFakes";
import type {
  ChatModelProvider,
  ChatRequest,
  ChatResponseChunk,
  ModelRoundProvider,
  ModelRoundRequest,
  ModelRoundResult,
} from "@core/agent";
import type { ResearchNoteWriter, ResearchStatePort } from "@application/ports";
import type { ResearchSectionView } from "@core/research/deepResearch";
import type { ResearchAnswer } from "@core/answer";
import type { RetrievedChunk } from "@core/model";
import {
  bindAnswerToConversationRegistry,
  createConversationSourceRegistry,
  registerConversationEvidence,
  resolveConversationEvidence,
} from "@core/chat/sourceRegistry";

/** Builds an enabled required branch covering the first objective. */
export function researchBranch(index: number, patch: Partial<ResearchBranch> = {}): ResearchBranch {
  return {
    branchId: `branch-${index}`,
    title: `Branch ${index}`,
    task: `Investigate aspect ${index}`,
    expectedOutput: "Findings",
    priority: "required",
    enabled: true,
    objectives: ["Objective"],
    sourceScope: "indexOnly",
    dependsOn: [],
    ...patch,
  };
}

/** Builds a valid plan with the given branches and the preset limits row. */
export function researchPlan(
  branches: readonly ResearchBranch[] = [researchBranch(1), researchBranch(2)],
  preset: ResearchPreset = "thorough",
  patch: Partial<ResearchPlan> = {},
): ResearchPlan {
  return {
    planId: "plan-1",
    revision: 1,
    objectives: ["Objective"],
    reportOutline: ["Summary"],
    branches,
    knownOmissions: [],
    preset,
    limits: presetLimits(preset),
    generationsUsed: 1,
    approvedAt: null,
    ...patch,
  };
}

/** Builds a research awaiting approval of the given plan. */
export function pendingResearch(plan: ResearchPlan = researchPlan()): ResearchState {
  return withPlanForReview(
    startResearchState("research-1", "Question", "2026-01-01T00:00:00.000Z"),
    plan,
    "decision-1",
    "2026-01-01T00:00:00.000Z",
  );
}

/** Returns the model reply of a valid plan as the plan generator expects it; the second branch depends on the first. */
export function planReply(branchCount: 2 | 3 = 2): string {
  const branches = [
    { title: "Background", task: "Collect background", expectedOutput: "Notes", objectives: [1] },
    { title: "Details", task: "Collect details", expectedOutput: "Notes", dependsOn: [1] },
    { title: "Context", task: "Collect context", expectedOutput: "Notes" },
  ];
  return JSON.stringify({
    objectives: ["Understand the topic"],
    reportOutline: ["Overview"],
    knownOmissions: [],
    branches: branches.slice(0, branchCount),
  });
}

/** Builds a research service with tool calling and an index whose model answers with the given replies. */
export function deepResearchService(
  model: ChatModelProvider,
  deepResearchEnabled = true,
  overrides: Partial<ResearchServiceOptions> = {},
): ResearchService {
  return new ResearchService({
    toolsetFactory: createResearchToolRegistry,
    runToolLoop,
    modelRoundFactory: (chatModel) => new ChatCompletionsRoundAdapter(chatModel),
    retriever: new FakeRetriever(emptyRetrieval()),
    chatModel: model,
    chatModelName: "model",
    deepResearchEnabled,
    toolCapabilities: {
      calls: true,
      choiceRequired: true,
      choiceSpecific: true,
      parallelCalls: false,
    },
    now: fixedNow,
    ...overrides,
  });
}

/** Builds a chat run request for one research turn. */
export function researchTurn(question: string, research?: ResearchTurnInput): ChatRunRequest {
  return {
    question,
    chatHistory: [],
    appendQuestion: true,
    contextPaths: [],
    includeActiveFile: false,
    includeContextDiagnostics: false,
    modelLabel: "model",
    ...(research ? { research } : {}),
  };
}

/** A model whose first call waits until its request is aborted and whose later calls reply with a plan. */
export class StallingPlanModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      await new Promise<never>((_, reject) => {
        request.signal?.addEventListener("abort", () =>
          reject(new DOMException("Stopped", "AbortError")),
        );
      });
    }
    yield { content: planReply(), isComplete: true };
  }
}

/** An in-memory research state port that applies every commit without revision checks. */
export class MemoryResearchState implements ResearchStatePort {
  readonly commits: ResearchState[] = [];

  read(): ResearchSectionView {
    const active = this.commits.at(-1) ?? null;
    return { status: "ready", active, history: [] };
  }

  async commit(next: ResearchState): Promise<void> {
    this.commits.push(next);
  }
}

/**
 * Model rounds of branch attempts: a first round searches the index for the branch task and the
 * next one answers with a finding citing the evidence id from the tool result. A task listed in
 * `hang` waits until its request is aborted or `releaseHangs` is called, after calling `onHang`.
 * The rounds started and the peak number of rounds in flight at once are recorded.
 */
export class BranchModelRounds implements ModelRoundProvider {
  readonly tasks: string[] = [];
  readonly hang = new Set<string>();
  onHang: () => void = () => undefined;
  peakConcurrentRounds = 0;
  startedRounds = 0;
  private activeRounds = 0;
  private releases: (() => void)[] = [];

  releaseHangs(): void {
    for (const release of this.releases.splice(0)) release();
  }

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async runRound(request: ModelRoundRequest): Promise<ModelRoundResult> {
    this.activeRounds += 1;
    this.startedRounds += 1;
    this.peakConcurrentRounds = Math.max(this.peakConcurrentRounds, this.activeRounds);
    try {
      await Promise.resolve();
      return await this.reply(request);
    } finally {
      this.activeRounds -= 1;
    }
  }

  private async reply(request: ModelRoundRequest): Promise<ModelRoundResult> {
    const last = request.messages.at(-1);
    if (last?.role === "tool") {
      const id = /"evidenceId"\s*:\s*"([^"]+)"/u.exec(String(last.content))?.[1] ?? "missing";
      return {
        items: [{ type: "text", text: `The moon pulls the oceans and causes tides [${id}].` }],
        stopReason: "complete",
      };
    }
    const task = String(
      request.messages.filter((message) => message.role === "user").at(-1)?.content,
    );
    this.tasks.push(task);
    if ([...this.hang].some((entry) => task.includes(entry))) {
      await new Promise<void>((resolve, reject) => {
        request.signal?.addEventListener("abort", () =>
          reject(new DOMException("Stopped", "AbortError")),
        );
        this.releases.push(resolve);
        this.onHang();
      });
    }
    return {
      items: [
        {
          type: "toolCall",
          call: {
            id: `call-${this.tasks.length}`,
            name: "search_index",
            arguments: { query: task.slice(0, 200) },
          },
        },
      ],
      stopReason: "tool_calls",
    };
  }
}

/**
 * Answers the clarification and verification calls of a research the way a cooperative model
 * would: the question is ready, every finding yields one claim with its first citation serving the
 * first objective, and each claim with a passage is supported by a quote copied from it. Returns
 * null for any other call.
 */
export function cooperativeResearchReply(request: ChatRequest): string | null {
  const system = String(request.messages[0]?.content);
  const user = String(request.messages.at(-1)?.content);
  if (system.startsWith("You decide whether")) {
    return JSON.stringify({ status: "ready", assumptions: ["Plain reading"] });
  }
  if (system.startsWith("You extract")) {
    const claims = [...user.matchAll(/<finding id="(\d+)">\n([\s\S]*?)\n<\/finding>/gu)].map(
      (match) => ({
        finding: Number(match[1]),
        text: match[2]!.replace(/\s*\[[^\]]+\]/gu, "").trim(),
        tokens: [...match[2]!.matchAll(/\[([^\]\s]+)\]/gu)].map((token) => token[1]),
        objective: 1,
      }),
    );
    return JSON.stringify({ claims });
  }
  if (system.startsWith("You check claims")) {
    const assessments = [...user.matchAll(/<claim id="(\d+)">([\s\S]*?)<\/claim>/gu)].map(
      (match) => {
        const passage = /<passage token="[^"]+">\n([\s\S]*?)\n<\/passage>/u.exec(match[2]!)?.[1];
        return passage
          ? {
              claim: Number(match[1]),
              verdict: "supported",
              quote: passage.slice(0, 20),
              contradicting: [],
            }
          : { claim: Number(match[1]), verdict: "unsupported", quote: null, contradicting: [] };
      },
    );
    return JSON.stringify({ assessments });
  }
  return null;
}

/**
 * A chat model that answers clarification and verification cooperatively, drafts a three-branch
 * plan and writes a summary citing the first verified claim token and one token no claim holds.
 */
export class PlanAndReportModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  onReport: () => void = () => undefined;

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const routed = cooperativeResearchReply(request);
    if (routed !== null) {
      yield { content: routed, isComplete: true };
      return;
    }
    if (String(request.messages[0]?.content).startsWith("You plan")) {
      yield { content: planReply(3), isComplete: true };
      return;
    }
    this.onReport();
    const claims = String(request.messages.at(-1)?.content);
    const token = /\[([^\]\s]+)\]/u.exec(claims.slice(claims.indexOf("Verified claims:")))?.[1];
    yield {
      content: `# Report\n\nThe moon pulls the oceans and causes tides [${token}]. Waves exist [source-9:revision-9].`,
      isComplete: true,
    };
  }
}

/** A conversation source registry with the answer registration and evidence lookup of a chat turn. */
export class ResearchRegistry {
  registry = createConversationSourceRegistry();

  readonly finalizeAnswer = (answer: ResearchAnswer): ResearchAnswer => {
    const registered = registerConversationEvidence(
      this.registry,
      answer.evidence ?? [],
      answer.createdAt,
    );
    this.registry = registered.registry;
    return bindAnswerToConversationRegistry(
      answer,
      registered.registry,
      registered.revisionIdByEvidenceId,
    );
  };

  readonly resolveEvidence = (revisionIds: readonly string[]): RetrievedChunk[] =>
    resolveConversationEvidence(this.registry, revisionIds);
}

/** Builds an approved research paused in gathering, optionally waiting on a stale-plan decision. */
export function pausedResearch(
  staleDecision = false,
  plan: Partial<ResearchPlan> = {},
): ResearchState {
  const pending = pendingResearch(
    researchPlan(undefined, "balanced", { approvedAt: "2026-01-01T00:00:00.000Z", ...plan }),
  );
  return {
    ...pending,
    phase: "gathering",
    pending: staleDecision
      ? {
          decisionId: "decision-stale",
          kind: "stale-plan",
          artifactRevision: pending.plan!.revision,
        }
      : null,
    executions: initialExecutions(pending.plan!),
    budget: {
      ...emptyBudgetState(),
      consumed: { branchAttempts: 1, modelRounds: 5, searches: 2, evidenceItems: 1 },
      attemptsByBranch: { "branch-1": 1 },
    },
  };
}

/** Builds an approved research of the given plan that is gathering and has spent nothing yet. */
export function gatheringResearch(plan: ResearchPlan): ResearchState {
  const approved = { ...plan, approvedAt: "2026-01-01T00:00:00.000Z" };
  return {
    ...pendingResearch(approved),
    phase: "gathering",
    pending: null,
    executions: initialExecutions(approved),
  };
}

/** A report model that verifies cooperatively and cites every bracketed token of the claims it receives, in order. */
export class CitingReportModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const routed = cooperativeResearchReply(request);
    if (routed !== null) {
      yield { content: routed, isComplete: true };
      return;
    }
    const findings = String(request.messages.at(-1)?.content);
    const tokens = [...findings.matchAll(/\[([^\]\s]+)\]/gu)].map((match) => match[1]);
    yield {
      content: `# Report\n\n${tokens.map((token) => `Fact [${token}].`).join(" ")}`,
      isComplete: true,
    };
  }
}

/**
 * A research model that answers planning, verification and the report like `PlanAndReportModel`
 * and replies to hypothesis proposals and assessments from scripted queues. A proposal revises the
 * first open hypothesis it is shown; an assessment quotes the first passage.
 */
export class DiscoveryModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];
  private readonly report = new PlanAndReportModel();

  constructor(
    readonly proposals: ("literature" | "observation")[],
    readonly verdicts: ("supports" | "contradicts" | "inconclusive")[],
  ) {}

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    const system = String(request.messages[0]?.content);
    const user = String(request.messages.at(-1)?.content);
    if (system.startsWith("You turn research findings")) {
      const kind = this.proposals.shift();
      const revises = /<hypothesis id="([^"]+)"/u.exec(user)?.[1] ?? null;
      const hypotheses = kind
        ? [
            {
              branch: 1,
              revises,
              claim: "The moon causes tides",
              alternative: "Wind causes tides [source-8:revision-8]",
              prediction: "Tides follow the moon",
              disconfirmation: "Tides ignore the moon",
              test: { kind, method: "Compare tide times with the moon" },
            },
          ]
        : [];
      yield { content: JSON.stringify({ hypotheses }), isComplete: true };
      return;
    }
    if (system.startsWith("You classify one result")) {
      const verdict = this.verdicts.shift() ?? "inconclusive";
      yield { content: JSON.stringify({ verdict }), isComplete: true };
      return;
    }
    if (system.startsWith("You judge one hypothesis")) {
      const passage = /<passage token="[^"]+">\n([\s\S]*?)\n<\/passage>/u.exec(user)?.[1] ?? "";
      const verdict = this.verdicts.shift() ?? "inconclusive";
      yield {
        content: JSON.stringify({ verdict, quote: passage.slice(0, 40) }),
        isComplete: true,
      };
      return;
    }
    yield* this.report.streamChat(request);
  }
}

/**
 * In-memory research note writer. A path listed in `raced` gets a file just before its create, as
 * if another writer won the race, `failures` makes the next creates throw, and `hold` pauses them.
 */
export class MemoryResearchNotes implements ResearchNoteWriter {
  readonly files = new Map<string, string>();
  readonly folders: string[] = [];
  raced = new Set<string>();
  failures = 0;
  creates = 0;
  private gate: Promise<void> | null = null;

  /** Holds every create until the returned release is called. */
  hold(): () => void {
    let release = () => {};
    this.gate = new Promise((resolve) => (release = resolve));
    return () => {
      this.gate = null;
      release();
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async ensureFolder(path: string): Promise<void> {
    this.folders.push(path);
  }

  async createNew(path: string, content: string): Promise<boolean> {
    this.creates += 1;
    if (this.gate) await this.gate;
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("Disk is full.");
    }
    if (this.raced.delete(path)) this.files.set(path, "other writer");
    if (this.files.has(path)) return false;
    this.files.set(path, content);
    return true;
  }
}

/** Builds a finished research report with the given markdown. */
export function finishedReport(markdown: string): ResearchReport {
  return {
    reportId: "report-1",
    quality: "partial",
    markdown,
    completedBranches: ["branch-1"],
    missingBranches: [],
    stopReason: "All branches settled.",
    createdAt: "2026-03-04T05:06:07.000Z",
    verification: null,
  };
}
