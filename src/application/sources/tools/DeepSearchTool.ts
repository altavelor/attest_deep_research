import {
  DeepResearchReportSource,
  formatDeepResearchReport,
  remapReportEvidenceIds,
} from "../../../core/research/deepResearch/deepResearchReport";
import { DeepResearchRunner } from "../../research/deepResearchPort";
import {
  failure,
  ResearchToolExecution,
  ResearchToolExecutionContext,
  ResearchToolHandler,
  ResearchToolParseResult,
} from "../../research/ResearchTools";
import { EvidenceRegistry } from "../evidence";

export interface DeepSearchInput {
  question: string;
  scope?: string;
}

export interface DeepSearchOutput {
  question: string;
  /** Formatted structured-evidence report the orchestrating model reads. */
  report: string;
  findingCount: number;
  sourceCount: number;
}

const MAX_QUESTION_CHARS = 500;
const MAX_SCOPE_CHARS = 500;
const MAX_REGISTERED_SNIPPET_CHARS = 2_000;

/**
 * Launches an in-process deep-research sub-agent for one research question. The
 * orchestrating (main) model can issue several `deep_search` calls — sequentially
 * or in parallel — to run multiple independent sessions. Each session's gathered
 * web evidence is re-registered into the parent run so the main model can cite the
 * same sources by their `evidenceId`.
 */
export class DeepSearchTool implements ResearchToolHandler<DeepSearchInput, DeepSearchOutput> {
  readonly definition = {
    type: "function" as const,
    function: {
      name: "deep_search",
      description:
        "Launch a deep-research sub-agent that plans, searches the web, cross-checks sources, " +
        "and returns structured evidence (findings with reliability + cited sources). Use for " +
        "questions needing breadth or verification; issue several calls to research facets in parallel.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", maxLength: MAX_QUESTION_CHARS },
          scope: { type: "string", maxLength: MAX_SCOPE_CHARS },
        },
        required: ["question"],
        additionalProperties: false,
      },
    },
  };

  private readonly runner: DeepResearchRunner;
  private readonly evidence: EvidenceRegistry;

  constructor(options: { runner: DeepResearchRunner; evidence: EvidenceRegistry }) {
    this.runner = options.runner;
    this.evidence = options.evidence;
  }

  parseInput(input: Record<string, unknown>): ResearchToolParseResult<DeepSearchInput> {
    const unknownProperty = Object.keys(input).find(
      (key) => key !== "question" && key !== "scope",
    );
    if (unknownProperty) {
      return failure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
        property: unknownProperty,
      });
    }

    const question = typeof input.question === "string" ? input.question.trim() : "";
    if (!question) {
      return failure("missing-question", "A research question is required.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return failure("question-too-long", `Question must not exceed ${MAX_QUESTION_CHARS} characters.`);
    }

    if (input.scope !== undefined && typeof input.scope !== "string") {
      return failure("invalid-scope", "Scope must be a string.");
    }
    const scope = typeof input.scope === "string" ? input.scope.trim() : undefined;
    if (scope && scope.length > MAX_SCOPE_CHARS) {
      return failure("scope-too-long", `Scope must not exceed ${MAX_SCOPE_CHARS} characters.`);
    }

    return { ok: true, value: { question, ...(scope ? { scope } : {}) } };
  }

  async execute(
    input: DeepSearchInput,
    context: ResearchToolExecutionContext,
  ): Promise<ResearchToolExecution<DeepSearchOutput>> {
    let run;
    try {
      run = await this.runner.run({
        question: input.question,
        scope: input.scope,
        signal: context.signal,
        onEvent: (event) => context.emit(event),
      });
    } catch {
      return failure("deep-research-failed", "Deep research session failed.", true);
    }

    // Re-register the sub-agent's web evidence into the parent run so the
    // orchestrating model cites the same sources by their parent evidenceId.
    const idMap = new Map<string, string>();
    const sources: DeepResearchReportSource[] = [];
    let rank = 1;
    for (const chunk of run.snapshot.evidence) {
      if (chunk.source.kind !== "web") continue;
      try {
        const registered = this.evidence.registerWebResult(
          {
            url: chunk.source.url,
            title: chunk.source.title,
            snippet: chunk.text.slice(0, MAX_REGISTERED_SNIPPET_CHARS),
            rank,
          },
          { callId: context.callId, query: input.question },
        );
        idMap.set(chunk.id, registered.evidenceId);
        sources.push({
          evidenceId: registered.evidenceId,
          title: chunk.source.title,
          url: registered.canonicalUrl,
        });
        rank += 1;
      } catch {
        // Skip a source that cannot be registered (e.g. unsafe URL).
      }
    }

    const report = remapReportEvidenceIds(run.report, idMap);

    return {
      ok: true,
      value: {
        question: input.question,
        report: formatDeepResearchReport(report, sources),
        findingCount: report.findings.length,
        sourceCount: sources.length,
      },
    };
  }
}
