import type {
  SubAgentDelegator,
  SubAgentImportedEvidenceResolver,
} from "@application/ports/subAgent";
import {
  MAX_FINDING_CITATION_TOKENS,
  boundFindingText,
  boundedReason,
  type BranchAllocation,
  type BranchFinding,
  type BranchRunRef,
  type BranchUsage,
  type ResearchBranch,
  type ResearchWork,
} from "@core/research/deepResearch";
import {
  MAX_SUB_AGENT_SEARCHES,
  SubAgentSessionFailure,
  replaceMarkdownCitationTokens,
  type ImportedSubAgentRunOutcome,
  type SubAgentResultState,
  type SubAgentRunReceipt,
  type SubAgentPromptSession,
  type SubAgentRunSummary,
} from "@core/research";
import { citationIdsFromText, removeUnknownCitationTokens } from "../strategies/citations";
import { MAX_WAIT_MS } from "@application/use-cases/sub-agent";
import { UnusableBranchSessionError, type BranchChildRun, type BranchRunner } from "./branchRunner";

export interface SubAgentBranchRunnerDeps {
  branches: readonly ResearchBranch[];
  delegator(branch: ResearchBranch, allocation: BranchAllocation): SubAgentDelegator;
  resolver: SubAgentImportedEvidenceResolver;
  sessionOf(branchId: string): string | null;
  listSessions?(): Promise<readonly SubAgentPromptSession[]>;
}

/**
 * Runs a branch attempt in the branch's chat-owned child session: it creates the session on first
 * use or sends a follow-up to it, waits for the committed result rather than the receipt, and builds
 * the finding from the imported outcome whose citations resolve in the conversation registry. A stop
 * of the attempt stops the child.
 */
export class SubAgentBranchRunner implements BranchRunner {
  readonly path = "sub-agent" as const;
  private readonly refs = new Map<string, BranchRunRef>();
  private readonly usages = new Map<string, BranchUsage>();
  private readonly childRuns = new Map<string, BranchChildRun>();

  constructor(private readonly deps: SubAgentBranchRunnerDeps) {}

  async run(
    work: ResearchWork,
    allocation: BranchAllocation,
    signal: AbortSignal,
  ): Promise<BranchFinding> {
    const branch = this.deps.branches.find((entry) => entry.branchId === work.branchId);
    if (!branch) throw new Error("The branch is not part of the plan.");
    this.refs.delete(work.workId);
    this.usages.delete(work.workId);
    this.childRuns.delete(work.workId);
    const delegator = this.deps.delegator(branch, allocation);
    const receipt = await this.submit(delegator, branch, work, allocation);
    const result = await this.waitForResult(delegator, receipt, signal);
    this.refs.set(work.workId, {
      sessionId: receipt.sessionId,
      runId: receipt.runId,
      resultRevision: result.resultRevision,
    });
    const run = result.state === "completed" ? result.outcome.run : result.run;
    const usage = measuredUsage(run);
    if (usage) this.usages.set(work.workId, usage);
    this.childRuns.set(work.workId, {
      outcome: result.state === "completed" ? "imported" : result.error.code,
      evidenceCount: run.evidenceCount,
    });
    if (result.state !== "completed") {
      throw new Error(boundedReason(`The child session ${result.state}: ${result.error.message}`));
    }
    return this.finding(result.outcome);
  }

  usage(workId: string): BranchUsage | null {
    return this.usages.get(workId) ?? null;
  }

  runRef(workId: string): BranchRunRef | null {
    return this.refs.get(workId) ?? null;
  }

  childRun(workId: string): BranchChildRun | null {
    return this.childRuns.get(workId) ?? null;
  }

  private async submit(
    delegator: SubAgentDelegator,
    branch: ResearchBranch,
    work: ResearchWork,
    allocation: BranchAllocation,
  ): Promise<SubAgentRunReceipt> {
    const submissionId = `${work.workId}-a${allocation.attempt}`;
    const existing = this.deps.sessionOf(branch.branchId);
    if (existing) {
      try {
        return await this.continueSession(delegator, existing, work.task, submissionId);
      } catch (error) {
        if (refusesSession(error)) throw new UnusableBranchSessionError(existing);
        throw error;
      }
    }
    const session = await delegator.create({
      createRequestId: `${submissionId}-create`,
      title: branch.title,
      maxSearches: Math.min(allocation.searches, MAX_SUB_AGENT_SEARCHES),
    });
    return delegator.run(
      session.subAgentSessionId,
      { type: "initial", task: work.task },
      submissionId,
    );
  }

  /**
   * Sends the next task to the branch's existing session in the form its state admits: the first
   * run of a session that never ran, a follow-up after a finished run, and a continuation of the
   * last run after a failure or interruption.
   */
  private async continueSession(
    delegator: SubAgentDelegator,
    sessionId: string,
    task: string,
    submissionId: string,
  ): Promise<SubAgentRunReceipt> {
    const sessions = (await this.deps.listSessions?.()) ?? [];
    const session = sessions.find((entry) => entry.sessionId === sessionId);
    if (session?.state === "stopped") {
      throw new UnusableBranchSessionError(sessionId);
    }
    if (session?.lastRunId === null) {
      return delegator.run(sessionId, { type: "initial", task }, submissionId);
    }
    if (session && (session.state === "failed" || session.state === "interrupted")) {
      const fromRunId = session.lastRunId;
      return delegator.continue(
        sessionId,
        { type: "continue-partial", task, fromRunId },
        submissionId,
      );
    }
    return delegator.continue(sessionId, { type: "follow-up", task }, submissionId);
  }

  private async waitForResult(
    delegator: SubAgentDelegator,
    receipt: SubAgentRunReceipt,
    signal: AbortSignal,
  ): Promise<Exclude<SubAgentResultState, { state: "pending" }>> {
    const ref = { sessionId: receipt.sessionId, runId: receipt.runId };
    for (;;) {
      const result = await delegator.getResult(ref.sessionId, ref.runId);
      if (result.state !== "pending") return result;
      if (signal.aborted) {
        await delegator.stop(receipt.sessionId).catch(() => undefined);
        throw new DOMException("Branch stopped", "AbortError");
      }
      await delegator
        .waitForResults([ref], { mode: "all", timeoutMs: MAX_WAIT_MS, signal })
        .catch((error: unknown) => {
          if (!signal.aborted) throw error;
        });
    }
  }

  private async finding(outcome: ImportedSubAgentRunOutcome): Promise<BranchFinding> {
    const snapshot = await this.deps.resolver.resolve(outcome);
    const present = new Set(snapshot.evidence.map((chunk) => chunk.id));
    const revisionOf = new Map(
      outcome.evidence
        .filter((entry) => present.has(entry.conversationEvidenceId))
        .map((entry) => [entry.conversationEvidenceId, entry.conversationRevisionId]),
    );
    const text = replaceMarkdownCitationTokens(
      removeUnknownCitationTokens(outcome.answerText, new Set(revisionOf.keys())),
      revisionOf,
    ).trim();
    if (text === "") throw new Error("The branch produced no findings.");
    const bounded = boundFindingText(text);
    const cited = citationIdsFromText(bounded);
    return {
      text: bounded,
      citationTokens: [...new Set(revisionOf.values())]
        .filter((id) => cited.has(id))
        .slice(0, MAX_FINDING_CITATION_TOKENS),
      partial: outcome.evidenceBudgetExhausted === true,
    };
  }
}

/** Reads the rounds and tool calls a child reported; evidence is charged when it is appended. */
function measuredUsage(run: SubAgentRunSummary | undefined): BranchUsage | null {
  const usage = run?.usage;
  if (!usage || !isCount(usage.modelRounds) || !isCount(usage.toolCalls)) return null;
  return { modelRounds: usage.modelRounds, searches: usage.toolCalls, evidenceItems: 0 };
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function refusesSession(error: unknown): boolean {
  return (
    error instanceof SubAgentSessionFailure &&
    (error.code === "not-authorized" || error.code === "invalid-state")
  );
}
