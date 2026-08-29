import { ToolParseResult, toolFailure } from "@core/agent";
import { SUB_AGENT_TOOL } from "@core/agent";
import { ResearchToolsetOptions, SubAgentPort } from "@application/research";
import { EvidenceRegistry, isWebResultCapacityError } from "@application/sources";
import { defineTool, int, str, strArray } from "@application/sources/tools";

export interface SubAgentInput {
  task: string;
  maxSearches: number;
  resources?: string[];
}

export interface SubAgentOutput {
  task: string;

  answer: string;
  sourceCount: number;
  droppedSourceCount: number;
  evidenceBudgetExhausted: boolean;
}

const MAX_TASK_CHARS = 2_000;
const MAX_REGISTERED_SNIPPET_CHARS = 2_000;

const MAX_RESOURCES = 8;
const MAX_RESOURCE_CHARS = 120;

const MIN_SUB_AGENT_SEARCHES = 1;
const MAX_SUB_AGENT_SEARCHES = 20;
const DEFAULT_SUB_AGENT_SEARCHES = 8;

const MAX_IMPORTED_WEB_SOURCES = 10;

const DOMAIN_RESOURCE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function parseSubAgentInput(input: Record<string, unknown>): ToolParseResult<SubAgentInput> {
  const unknownProperty = Object.keys(input).find(
    (key) => !["task", "maxSearches", "resources"].includes(key),
  );
  if (unknownProperty) {
    return toolFailure("unknown-property", `Unknown property: ${unknownProperty}.`, false, {
      property: unknownProperty,
    });
  }

  const task = typeof input.task === "string" ? input.task.trim() : "";
  if (!task) {
    return toolFailure("missing-task", "A task instruction is required.");
  }
  if (task.length > MAX_TASK_CHARS) {
    return toolFailure("task-too-long", `Task must not exceed ${MAX_TASK_CHARS} characters.`);
  }

  const maxSearches = readSearchBudget(input.maxSearches);
  if (maxSearches === false) {
    return toolFailure("invalid-max-searches", "maxSearches must be an integer.");
  }

  const resources = readResources(input.resources);
  if (resources === false) {
    return toolFailure(
      "invalid-resources",
      `resources must be an array of at most ${MAX_RESOURCES} non-empty strings.`,
    );
  }

  return {
    ok: true,
    value: { task, maxSearches, ...(resources.length > 0 ? { resources } : {}) },
  };
}

function readSearchBudget(value: unknown): number | false {
  if (value === undefined) return DEFAULT_SUB_AGENT_SEARCHES;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return false;
  }
  return Math.max(MIN_SUB_AGENT_SEARCHES, Math.min(MAX_SUB_AGENT_SEARCHES, value));
}

function readResources(value: unknown): string[] | false {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RESOURCES) return false;
  const entries = value.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
  if (entries.some((entry) => entry.length === 0 || entry.length > MAX_RESOURCE_CHARS)) {
    return false;
  }
  return entries;
}

/**
 * True when the URL belongs to one of the allowed hosts, matching a host and its
 * subdomains. An empty allow-list permits everything; an unparsable URL is refused.
 */
function hostAllowed(url: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export const SubAgentTool = defineTool<
  { runner: SubAgentPort; evidence: EvidenceRegistry; toolContext?: ResearchToolsetOptions },
  SubAgentInput,
  SubAgentOutput
>({
  name: SUB_AGENT_TOOL,
  description:
    "Launch a sub-agent to autonomously complete one self-contained task, with the same " +
    "read-only tools you have (index/web/notes). Use for delegating a facet of the work — " +
    "deep web research, cross-checking facts, reading and comparing several notes — " +
    "especially when several independent facets can run in parallel (up to 3 at once). " +
    "Name the resources the sub-agent may consult and keep its search budget tight: every " +
    "source it registers is charged to the shared evidence budget of this run.",
  schema: {
    task: str(MAX_TASK_CHARS, {
      required: true,
      description: "Self-contained task for the sub-agent, including the success criteria.",
    }),
    maxSearches: int(MIN_SUB_AGENT_SEARCHES, MAX_SUB_AGENT_SEARCHES, DEFAULT_SUB_AGENT_SEARCHES, {
      description:
        "Maximum search calls the sub-agent may spend on the whole task. Keep it small; " +
        "further searches are rejected.",
    }),
    resources: strArray(MAX_RESOURCES, MAX_RESOURCE_CHARS, {
      description:
        "Sites, domains, or named sources the sub-agent must restrict itself to, " +
        'e.g. "wikipedia.org", "official investor relations pages".',
    }),
  },
  parse: parseSubAgentInput,
  execute: async (deps, input, context) => {
    let run;
    try {
      run = await deps.runner.run({
        task: input.task,
        budget: { maxSearches: input.maxSearches },
        ...(input.resources ? { resources: input.resources } : {}),
        toolContext: deps.toolContext,
        signal: context.signal,
        onEvent: (event) => context.emit(event),
      });
    } catch {
      return toolFailure("sub-agent-failed", "Sub-agent session failed.", true);
    }

    const allowedHosts = (input.resources ?? [])
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => DOMAIN_RESOURCE.test(entry));

    let sourceCount = 0;
    let webSourceCount = 0;
    let droppedSourceCount = 0;
    let evidenceBudgetExhausted = false;
    const droppedCitationTokens: string[] = [];
    for (const chunk of run.snapshot.evidence) {
      const provenance = run.snapshot.provenance.find((entry) => entry.evidenceId === chunk.id);
      const call = provenance?.calls[0];
      try {
        if (chunk.source.kind === "web") {
          if (call?.tool !== "search_web" && call?.tool !== "fetch_web_page") {
            droppedSourceCount += 1;
            droppedCitationTokens.push(chunk.id, `url:${chunk.source.url}`);
            continue;
          }
          if (
            webSourceCount >= MAX_IMPORTED_WEB_SOURCES ||
            !hostAllowed(chunk.source.url, allowedHosts)
          ) {
            droppedSourceCount += 1;
            droppedCitationTokens.push(chunk.id, `url:${chunk.source.url}`);
            continue;
          }
          deps.evidence.registerWebResult(
            {
              url: chunk.source.url,
              title: chunk.source.title,
              snippet: chunk.text.slice(0, MAX_REGISTERED_SNIPPET_CHARS),
              rank: sourceCount + 1,
            },
            { callId: context.callId, query: call?.query ?? input.task },
          );
          webSourceCount += 1;
        } else if (call?.tool === "read_note" || call?.tool === "get_active_note") {
          deps.evidence.registerNoteEvidence(
            { evidenceId: chunk.id, source: chunk.source, content: chunk.text },
            { callId: context.callId, tool: call.tool },
          );
        } else if (call?.tool === "search_index") {
          deps.evidence.registerIndexChunk(chunk, {
            callId: context.callId,
            query: call?.query ?? input.task,
          });
        } else {
          droppedSourceCount += 1;
          droppedCitationTokens.push(chunk.id);
          continue;
        }
        sourceCount += 1;
      } catch (error) {
        droppedSourceCount += 1;
        droppedCitationTokens.push(
          chunk.id,
          ...(chunk.source.kind === "web" ? [`url:${chunk.source.url}`] : []),
        );
        if (isWebResultCapacityError(error)) {
          evidenceBudgetExhausted = true;
        }
      }
    }

    return {
      ok: true,
      value: {
        task: input.task,
        answer: redactDroppedCitations(run.answerText, droppedCitationTokens),
        sourceCount,
        droppedSourceCount,
        evidenceBudgetExhausted,
      },
    };
  },
});

function redactDroppedCitations(answer: string, tokens: readonly string[]): string {
  return [...new Set(tokens)].reduce(
    (text, token) => text.replaceAll(`[${token}]`, "[source unavailable]"),
    answer,
  );
}
