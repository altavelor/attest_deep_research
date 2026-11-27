import type { ResearchAnswer } from "@core/answer";
import type { ResearchModeWebParameters } from "@core/research";
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
import type { PageCacheStore } from "@application/ports/pageCache";
import type { SubAgentPort } from "@application/research/subAgentPort";
import {
  citationIdsFromText,
  normalizeCitationTokens,
  removeUnknownCitationTokens,
  webUrlEvidenceIndex,
} from "../strategies/citations";
import {
  BranchNoFindingsError,
  BranchUnavailableError,
  RESEARCH_BRANCH_MAX_RESULT_CHARS,
  openedDocuments,
  type BranchRunner,
} from "./branchRunner";
import { subAgentToolContext, type SubAgentToolSources } from "../sub-agent/subAgentToolContext";

export interface MainBranchRunnerDeps {
  engine: SubAgentPort;
  sources: SubAgentToolSources;
  web: ResearchModeWebParameters;
  pageCacheStore?: PageCacheStore;
  chatScope: ResearchSourceScope;
  branches: readonly ResearchBranch[];
  registerAnswer?(answer: ResearchAnswer): ResearchAnswer;
  onEvent?(event: ResearchStreamEvent): void;
  now(): Date;
}

/**
 * Runs a branch in the parent run with the Thinking engine: the branch task is the question of a
 * fresh model context, tools follow the branch scope intersected with the chat's scope without
 * sub-agents or note mutation, and the allocation bounds rounds and searches. Pages it fetches are
 * kept in a cache of that attempt only, released when it ends. Evidence enters the conversation
 * registry through the answer registration of the chat turn.
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
    const cacheId = `main-branch-${work.workId}-a${allocation.attempt}`;
    const { pageCacheStore } = this.deps;
    const toolContext = subAgentToolContext(
      this.deps.sources,
      {
        searchMode: scope,
        contextPaths: [],
        indexScope: scope === "webOnly" ? "none" : "all-allowed",
        allowActiveFile: false,
        allowNoteMutation: false,
      },
      this.deps.web,
    );
    const result = await this.deps.engine
      .run({
        task: work.task,
        toolContext: pageCacheStore
          ? { ...toolContext, pageCache: pageCacheStore.forSession(cacheId) }
          : toolContext,
        budget: {
          maxRounds: allocation.modelRounds,
          maxSearches: allocation.searches,
          ...(pageCacheStore ? { maxResultChars: RESEARCH_BRANCH_MAX_RESULT_CHARS } : {}),
        },
        signal,
        onToolCall: (call) =>
          emit?.({ type: "tool-call-start", ...call, id: `${work.workId}:${call.id}` }),
        onToolResult: (outcome) =>
          emit?.({ type: "tool-call-end", ...outcome, id: `${work.workId}:${outcome.id}` }),
      })
      .finally(() => pageCacheStore?.release(cacheId));
    const evidence = [...result.snapshot.evidence];
    const telemetry = result.telemetry;
    const opened = openedDocuments(result.snapshot);
    this.usages.set(work.workId, {
      modelRounds: telemetry?.rounds ?? allocation.modelRounds,
      searches: telemetry?.searchCalls ?? allocation.searches,
      evidenceItems: opened,
      fetches: opened,
      sources: result.snapshot.evidence.length,
      ...(telemetry?.toolCounts ? { toolCounts: telemetry.toolCounts } : {}),
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
    if (text === "") throw new BranchNoFindingsError();
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
