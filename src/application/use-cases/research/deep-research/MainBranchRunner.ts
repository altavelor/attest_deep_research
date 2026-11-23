import type { ResearchAnswer } from "@core/answer";
import { isDocumentReadTool, type ResearchModeWebParameters } from "@core/research";
import {
  MAX_FINDING_CITATION_TOKENS,
  boundFindingText,
  intersectScope,
  type BranchAllocation,
  type BranchFinding,
  type BranchUsage,
  type ResearchBranch,
  type ResearchSourceScope,
  type ResearchWork,
} from "@core/research/deepResearch";
import type { ResearchStreamEvent } from "@application/contracts/research";
import type { SubAgentPort } from "@application/research/subAgentPort";
import {
  citationIdsFromText,
  normalizeCitationTokens,
  removeUnknownCitationTokens,
  webUrlEvidenceIndex,
} from "../strategies/citations";
import { BranchUnavailableError, type BranchRunner } from "./branchRunner";
import { subAgentToolContext, type SubAgentToolSources } from "../sub-agent/subAgentToolContext";

export interface MainBranchRunnerDeps {
  engine: SubAgentPort;
  sources: SubAgentToolSources;
  web: ResearchModeWebParameters;
  chatScope: ResearchSourceScope;
  branches: readonly ResearchBranch[];
  registerAnswer?(answer: ResearchAnswer): ResearchAnswer;
  onEvent?(event: ResearchStreamEvent): void;
  now(): Date;
}

/**
 * Runs a branch in the parent run with the Thinking engine: the branch task is the question of a
 * fresh model context, tools follow the branch scope intersected with the chat's scope without
 * sub-agents or note mutation, and the allocation bounds rounds and searches. Evidence enters the
 * conversation registry through the answer registration of the chat turn.
 */
export class MainBranchRunner implements BranchRunner {
  readonly path = "main" as const;
  private readonly usages = new Map<string, BranchUsage>();

  constructor(private readonly deps: MainBranchRunnerDeps) {}

  async run(
    work: ResearchWork,
    allocation: BranchAllocation,
    signal: AbortSignal,
  ): Promise<BranchFinding> {
    const branch = this.deps.branches.find((entry) => entry.branchId === work.branchId);
    const scope = branch ? intersectScope(branch.sourceScope, this.deps.chatScope) : null;
    if (!scope)
      throw new BranchUnavailableError("The branch has no source available in this chat.");
    this.usages.delete(work.workId);
    const emit = this.deps.onEvent;
    const result = await this.deps.engine.run({
      task: work.task,
      toolContext: subAgentToolContext(
        this.deps.sources,
        {
          searchMode: scope,
          contextPaths: [],
          indexScope: scope === "webOnly" ? "none" : "all-allowed",
          allowActiveFile: false,
          allowNoteMutation: false,
        },
        this.deps.web,
      ),
      budget: { maxRounds: allocation.modelRounds, maxSearches: allocation.searches },
      signal,
      onToolCall: (call) =>
        emit?.({ type: "tool-call-start", ...call, id: `${work.workId}:${call.id}` }),
      onToolResult: (outcome) =>
        emit?.({ type: "tool-call-end", ...outcome, id: `${work.workId}:${outcome.id}` }),
    });
    const evidence = [...result.snapshot.evidence];
    const telemetry = result.telemetry;
    this.usages.set(work.workId, {
      modelRounds: telemetry?.rounds ?? allocation.modelRounds,
      searches: telemetry?.searchCalls ?? allocation.searches,
      evidenceItems: result.snapshot.provenance.filter((entry) =>
        entry.calls.some((call) => isDocumentReadTool(call.tool)),
      ).length,
      ...(telemetry
        ? { inputTokens: telemetry.usage.inputTokens, outputTokens: telemetry.usage.outputTokens }
        : {}),
    });
    if (signal.aborted) throw new DOMException("Branch stopped", "AbortError");
    const normalized = normalizeCitationTokens(result.answerText, webUrlEvidenceIndex(evidence), {
      allowUnregisteredWebReferences: false,
    });
    const text = removeUnknownCitationTokens(
      normalized.text,
      new Set(evidence.map((chunk) => chunk.id)),
    ).trim();
    if (text === "") throw new Error("The branch produced no findings.");
    const answer: ResearchAnswer = {
      question: work.task,
      answer: text,
      citations: [...result.snapshot.citations],
      evidence,
      followUpQuestions: [],
      createdAt: this.deps.now().toISOString(),
    };
    const registered = this.deps.registerAnswer?.(answer) ?? answer;
    const bounded = boundFindingText(registered.answer);
    const cited = citationIdsFromText(bounded);
    return {
      text: bounded,
      citationTokens: [...new Set((registered.evidence ?? []).map((chunk) => chunk.id))]
        .filter((id) => cited.has(id))
        .slice(0, MAX_FINDING_CITATION_TOKENS),
      partial: telemetry?.failureReason !== undefined,
    };
  }

  usage(workId: string): BranchUsage | null {
    return this.usages.get(workId) ?? null;
  }
}
