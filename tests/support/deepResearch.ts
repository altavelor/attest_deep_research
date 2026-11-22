import {
  presetLimits,
  withPlanForReview,
  startResearchState,
  type ResearchBranch,
  type ResearchPlan,
  type ResearchPreset,
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
import type { ResearchStatePort } from "@application/ports";
import type { ResearchSectionView } from "@core/research/deepResearch";

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
 * `hang` waits until its request is aborted, after calling `onHang`.
 */
export class BranchModelRounds implements ModelRoundProvider {
  readonly tasks: string[] = [];
  readonly hang = new Set<string>();
  onHang: () => void = () => undefined;

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async runRound(request: ModelRoundRequest): Promise<ModelRoundResult> {
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
      await new Promise<never>((_, reject) => {
        request.signal?.addEventListener("abort", () =>
          reject(new DOMException("Stopped", "AbortError")),
        );
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
            arguments: { query: task },
          },
        },
      ],
      stopReason: "tool_calls",
    };
  }
}

/** A chat model that drafts a three-branch plan first and then writes a report citing the first finding token. */
export class PlanAndReportModel implements ChatModelProvider {
  readonly requests: ChatRequest[] = [];

  async listModels(): Promise<string[]> {
    return ["model"];
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatResponseChunk> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      yield { content: planReply(3), isComplete: true };
      return;
    }
    const findings = String(request.messages.at(-1)?.content);
    const token = /\[([^\]\s]+)\]/u.exec(findings.slice(findings.indexOf("Findings:")))?.[1];
    yield {
      content: `# Report\n\nThe moon pulls the oceans and causes tides [${token}].`,
      isComplete: true,
    };
  }
}
