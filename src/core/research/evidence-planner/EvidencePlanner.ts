import { EvidencePlannerDiagnostics } from "@core/diagnostics";
import { RetrievedChunk, uniqueChunks } from "@core/model/source";
import { ResearchSearchMode } from "../searchMode";
import { estimateTextTokens, ResearchChatHistoryMessage } from "../prompts";

export interface EvidencePlannerInput {
  question: string;
  chatHistory?: ResearchChatHistoryMessage[];
  contextLimitTokens?: number;
  reservedOutputTokens?: number;
  evidenceLimit: number;
  searchMode: ResearchSearchMode;
  explicitEvidence: RetrievedChunk[];
  graphEvidence: RetrievedChunk[];
  retrievalEvidence: RetrievedChunk[];
  webEvidence: RetrievedChunk[];
}

export interface EvidencePlannerOutput {
  explicitEvidence: RetrievedChunk[];
  graphEvidence: RetrievedChunk[];
  retrievedEvidence: RetrievedChunk[];
  webEvidence: RetrievedChunk[];
  finalEvidence: RetrievedChunk[];
  diagnostics: EvidencePlannerDiagnostics;
}

export interface EvidencePlannerOptions {
  useWebWhenFreshnessNeeded?: boolean;
}

export interface WebEvidenceRequirementInput {
  question: string;
  searchMode: ResearchSearchMode;
  explicitEvidence: RetrievedChunk[];
  graphEvidence: RetrievedChunk[];
  retrievalEvidence: RetrievedChunk[];
}

type EvidenceGroupName = "explicit" | "graph" | "retrieval" | "web";
type PlannerPolicy = EvidencePlannerDiagnostics["budget"]["policy"];

const DEFAULT_WEB_SHARE = 0.2;
const FRESHNESS_WEB_SHARE = 0.4;
const WEAK_LOCAL_WEB_SHARE = 0.5;
const FALLBACK_TOKENS_PER_EVIDENCE_ITEM = 500;

const FRESHNESS_TERMS = [
  "latest",
  "current",
  "today",
  "now",
  "recent",
  "new version",
  "price",
  "pricing",
  "changelog",
  "release notes",
  "api version",
  "сейчас",
  "актуально",
  "актуальная",
  "актуальный",
  "сегодня",
  "последняя",
  "последний",
  "новая версия",
  "цена",
  "стоимость",
];

export class EvidencePlanner {
  private readonly useWebWhenFreshnessNeeded: boolean;

  constructor(options: EvidencePlannerOptions = {}) {
    this.useWebWhenFreshnessNeeded = options.useWebWhenFreshnessNeeded ?? true;
  }

  /**
   * Whether the planner would put web evidence ahead of local evidence for this
   * turn. Callers use it to decide when waiting for a speculative web branch is
   * worth the latency; a `local-first` plan uses web results only as filler.
   */
  requiresWebEvidence(input: WebEvidenceRequirementInput): boolean {
    const webIntent = detectWebIntent(
      input.question,
      input.searchMode,
      this.useWebWhenFreshnessNeeded,
    );
    const policy = resolvePolicy(input.searchMode, webIntent.detected, isWeakLocalEvidence(input));

    return policy === "web-only" || policy === "freshness" || policy === "weak-local";
  }

  plan(input: EvidencePlannerInput): EvidencePlannerOutput {
    const webIntent = detectWebIntent(
      input.question,
      input.searchMode,
      this.useWebWhenFreshnessNeeded,
    );
    const localQuality = evaluateLocalEvidence(input);
    const policy = resolvePolicy(input.searchMode, webIntent.detected, localQuality.weak);
    const slots = allocateSlots(input.evidenceLimit, policy);
    const tokenBudget = createTokenBudget(input, slots);
    const dropped: EvidencePlannerDiagnostics["dropped"] = {
      explicitChunkIds: [],
      graphChunkIds: [],
      retrievalChunkIds: [],
      webChunkIds: [],
    };
    const seen = new Set<string>();

    if (input.searchMode === "webOnly") {
      const web = takeGroup(input.webEvidence, slots.web, tokenBudget.web, seen);
      dropped.webChunkIds.push(...droppedIds(input.webEvidence, web.included, seen));
      return buildOutput({
        input,
        policy,
        webIntent,
        localQuality,
        slots,
        tokenBudget,
        groups: { explicit: [], graph: [], retrieval: [], web: web.included },
        dropped,
      });
    }

    const explicit = takeGroup(input.explicitEvidence, slots.explicit, tokenBudget.explicit, seen);
    const remainingAfterExplicit = Math.max(0, input.evidenceLimit - explicit.included.length);
    const webSlots = Math.min(slots.web, remainingAfterExplicit);
    const localSlots =
      input.searchMode === "indexOnly" || input.searchMode === "none"
        ? remainingAfterExplicit
        : Math.max(0, remainingAfterExplicit - webSlots);

    const groups =
      policy === "freshness"
        ? takeFreshnessGroups(input, slots, tokenBudget, seen, webSlots, localSlots)
        : takeLocalFirstGroups(input, slots, tokenBudget, seen, webSlots, localSlots);

    const usedNonExplicit = groups.graph.length + groups.retrieval.length + groups.web.length;
    const unusedSlots = Math.max(0, remainingAfterExplicit - usedNonExplicit);

    if (
      unusedSlots > 0 &&
      groups.web.length < input.webEvidence.length &&
      policy !== "index-only"
    ) {
      groups.web.push(
        ...takeGroup(
          input.webEvidence.filter((chunk) => !seen.has(chunk.id)),
          unusedSlots,
          tokenBudget.web,
          seen,
        ).included,
      );
    }

    dropped.explicitChunkIds.push(...groupDroppedIds(input.explicitEvidence, explicit.included));
    dropped.graphChunkIds.push(...groupDroppedIds(input.graphEvidence, groups.graph));
    dropped.retrievalChunkIds.push(...groupDroppedIds(input.retrievalEvidence, groups.retrieval));
    dropped.webChunkIds.push(...groupDroppedIds(input.webEvidence, groups.web));

    return buildOutput({
      input,
      policy,
      webIntent,
      localQuality,
      slots,
      tokenBudget,
      groups: {
        explicit: explicit.included,
        graph: groups.graph,
        retrieval: groups.retrieval,
        web: groups.web,
      },
      dropped,
    });
  }
}

function takeLocalFirstGroups(
  input: EvidencePlannerInput,
  slots: Record<EvidenceGroupName, number>,
  tokenBudget: Record<EvidenceGroupName, number>,
  seen: Set<string>,
  webSlots: number,
  localSlots: number,
): { graph: RetrievedChunk[]; retrieval: RetrievedChunk[]; web: RetrievedChunk[] } {
  const graph = takeGroup(
    input.graphEvidence,
    Math.min(slots.graph, localSlots),
    tokenBudget.graph,
    seen,
  ).included;
  const retrieval = takeGroup(
    input.retrievalEvidence,
    Math.max(0, localSlots - graph.length),
    tokenBudget.retrieval,
    seen,
  ).included;
  const web =
    input.searchMode === "indexOnly" || input.searchMode === "none"
      ? []
      : takeGroup(input.webEvidence, webSlots, tokenBudget.web, seen).included;

  return { graph, retrieval, web };
}

function takeFreshnessGroups(
  input: EvidencePlannerInput,
  slots: Record<EvidenceGroupName, number>,
  tokenBudget: Record<EvidenceGroupName, number>,
  seen: Set<string>,
  webSlots: number,
  localSlots: number,
): { graph: RetrievedChunk[]; retrieval: RetrievedChunk[]; web: RetrievedChunk[] } {
  const web = takeGroup(input.webEvidence, webSlots, tokenBudget.web, seen).included;
  const graph = takeGroup(
    input.graphEvidence,
    Math.min(slots.graph, localSlots),
    tokenBudget.graph,
    seen,
  ).included;
  const retrieval = takeGroup(
    input.retrievalEvidence,
    Math.max(0, localSlots - graph.length),
    tokenBudget.retrieval,
    seen,
  ).included;

  return { graph, retrieval, web };
}

function buildOutput(input: {
  input: EvidencePlannerInput;
  policy: PlannerPolicy;
  webIntent: EvidencePlannerDiagnostics["webIntent"];
  localQuality: EvidencePlannerDiagnostics["localEvidenceQuality"];
  slots: Record<EvidenceGroupName, number>;
  tokenBudget: Record<EvidenceGroupName, number>;
  groups: Record<EvidenceGroupName, RetrievedChunk[]>;
  dropped: EvidencePlannerDiagnostics["dropped"];
}): EvidencePlannerOutput {
  const finalEvidence = uniqueChunks([
    ...input.groups.explicit,
    ...(input.policy === "freshness" ? input.groups.web : []),
    ...input.groups.graph,
    ...input.groups.retrieval,
    ...(input.policy === "freshness" ? [] : input.groups.web),
  ]).slice(0, input.input.evidenceLimit);
  const finalIds = new Set(finalEvidence.map((chunk) => chunk.id));
  const outputGroups = {
    explicit: input.groups.explicit.filter((chunk) => finalIds.has(chunk.id)),
    graph: input.groups.graph.filter((chunk) => finalIds.has(chunk.id)),
    retrieval: input.groups.retrieval.filter((chunk) => finalIds.has(chunk.id)),
    web: input.groups.web.filter((chunk) => finalIds.has(chunk.id)),
  };
  const dropped = {
    explicitChunkIds: uniqueIds([
      ...input.dropped.explicitChunkIds,
      ...input.groups.explicit.filter((chunk) => !finalIds.has(chunk.id)).map((chunk) => chunk.id),
    ]),
    graphChunkIds: uniqueIds([
      ...input.dropped.graphChunkIds,
      ...input.groups.graph.filter((chunk) => !finalIds.has(chunk.id)).map((chunk) => chunk.id),
    ]),
    retrievalChunkIds: uniqueIds([
      ...input.dropped.retrievalChunkIds,
      ...input.groups.retrieval.filter((chunk) => !finalIds.has(chunk.id)).map((chunk) => chunk.id),
    ]),
    webChunkIds: uniqueIds([
      ...input.dropped.webChunkIds,
      ...input.groups.web.filter((chunk) => !finalIds.has(chunk.id)).map((chunk) => chunk.id),
    ]),
  };

  return {
    explicitEvidence: outputGroups.explicit,
    graphEvidence: outputGroups.graph,
    retrievedEvidence: outputGroups.retrieval,
    webEvidence: outputGroups.web,
    finalEvidence,
    diagnostics: {
      webIntent: input.webIntent,
      localEvidenceQuality: input.localQuality,
      budget: {
        policy: input.policy,
        evidenceLimit: input.input.evidenceLimit,
        contextLimitTokens: input.input.contextLimitTokens,
        reservedOutputTokens: input.input.reservedOutputTokens,
        groups: (["explicit", "graph", "retrieval", "web"] as EvidenceGroupName[]).map((name) => ({
          name,
          allocatedTokens: input.tokenBudget[name],
          usedTokens: estimateChunksTokens(outputGroups[name]),
          includedItems: outputGroups[name].length,
          droppedItems: dropped[groupDroppedKey(name)].length,
        })),
      },
      dropped,
    },
  };
}

function groupDroppedKey(name: EvidenceGroupName): keyof EvidencePlannerDiagnostics["dropped"] {
  switch (name) {
    case "explicit":
      return "explicitChunkIds";
    case "graph":
      return "graphChunkIds";
    case "retrieval":
      return "retrievalChunkIds";
    case "web":
      return "webChunkIds";
  }
}

function allocateSlots(limit: number, policy: PlannerPolicy): Record<EvidenceGroupName, number> {
  if (policy === "web-only") {
    return { explicit: 0, graph: 0, retrieval: 0, web: limit };
  }

  if (policy === "index-only") {
    return {
      explicit: limit,
      graph: Math.max(1, Math.ceil(limit * 0.25)),
      retrieval: limit,
      web: 0,
    };
  }

  const webShare =
    policy === "freshness"
      ? FRESHNESS_WEB_SHARE
      : policy === "weak-local"
        ? WEAK_LOCAL_WEB_SHARE
        : DEFAULT_WEB_SHARE;
  const webSlots = Math.max(1, Math.ceil(limit * webShare));

  return {
    explicit: limit,
    graph: Math.max(1, Math.ceil(limit * 0.25)),
    retrieval: limit,
    web: webSlots,
  };
}

function createTokenBudget(
  input: EvidencePlannerInput,
  slots: Record<EvidenceGroupName, number>,
): Record<EvidenceGroupName, number> {
  if (!input.contextLimitTokens) {
    return {
      explicit: slots.explicit * FALLBACK_TOKENS_PER_EVIDENCE_ITEM,
      graph: slots.graph * FALLBACK_TOKENS_PER_EVIDENCE_ITEM,
      retrieval: slots.retrieval * FALLBACK_TOKENS_PER_EVIDENCE_ITEM,
      web: slots.web * FALLBACK_TOKENS_PER_EVIDENCE_ITEM,
    };
  }

  const historyTokens = (input.chatHistory ?? []).reduce(
    (total, message) => total + estimateTextTokens(message.content),
    0,
  );
  const available = Math.max(
    0,
    input.contextLimitTokens - (input.reservedOutputTokens ?? 0) - historyTokens,
  );

  return {
    explicit: Math.floor(available * 0.4),
    graph: Math.floor(available * 0.2),
    retrieval: Math.floor(available * 0.25),
    web: Math.floor(available * 0.15),
  };
}

function takeGroup(
  chunks: RetrievedChunk[],
  limit: number,
  tokenBudget: number,
  seen: Set<string>,
): { included: RetrievedChunk[] } {
  const included: RetrievedChunk[] = [];
  let usedTokens = 0;

  for (const chunk of chunks) {
    if (included.length >= limit || seen.has(chunk.id)) {
      continue;
    }

    const tokens = estimateTextTokens(chunk.text);
    if (usedTokens + tokens > tokenBudget) {
      continue;
    }

    included.push(chunk);
    seen.add(chunk.id);
    usedTokens += tokens;
  }

  return { included };
}

function detectWebIntent(
  question: string,
  searchMode: ResearchSearchMode,
  useWebWhenFreshnessNeeded: boolean,
): EvidencePlannerDiagnostics["webIntent"] {
  if (searchMode === "webOnly") {
    return { detected: true, reason: "web-only", matchedTerms: [] };
  }

  if (searchMode !== "indexAndWeb" || !useWebWhenFreshnessNeeded) {
    return { detected: false, reason: "none", matchedTerms: [] };
  }

  const normalized = question.toLowerCase();
  const matchedTerms = FRESHNESS_TERMS.filter((term) => normalized.includes(term));

  return matchedTerms.length > 0
    ? { detected: true, reason: "freshness-keyword", matchedTerms }
    : { detected: false, reason: "none", matchedTerms: [] };
}

/**
 * Describe the local evidence for diagnostics. `averageRetrievalScore` is reported
 * as-is and never thresholded: retrieval fuses its inputs with reciprocal rank, so
 * the score is ordinal and its magnitude says nothing about relevance.
 */
function evaluateLocalEvidence(
  input: EvidencePlannerInput,
): EvidencePlannerDiagnostics["localEvidenceQuality"] {
  const retrievalScores = input.retrievalEvidence.map((chunk) => chunk.score);
  const averageRetrievalScore =
    retrievalScores.length > 0
      ? retrievalScores.reduce((total, score) => total + score, 0) / retrievalScores.length
      : undefined;
  const reasons: string[] = [];

  if (input.explicitEvidence.length === 0) {
    reasons.push("no-explicit-evidence");
  }
  if (input.graphEvidence.length === 0) {
    reasons.push("no-graph-evidence");
  }
  if (input.retrievalEvidence.length < 3) {
    reasons.push("few-retrieval-chunks");
  }
  return {
    weak: isWeakLocalEvidence(input),
    explicitChunks: input.explicitEvidence.length,
    graphChunks: input.graphEvidence.length,
    retrievalChunks: input.retrievalEvidence.length,
    averageRetrievalScore,
    reasons,
  };
}

function isWeakLocalEvidence(input: WebEvidenceRequirementInput): boolean {
  return (
    input.explicitEvidence.length === 0 &&
    (input.retrievalEvidence.length < 3 || input.graphEvidence.length === 0)
  );
}

function resolvePolicy(
  searchMode: ResearchSearchMode,
  hasWebIntent: boolean,
  weakLocalEvidence: boolean,
): PlannerPolicy {
  if (searchMode === "webOnly") {
    return "web-only";
  }

  if (searchMode === "indexOnly" || searchMode === "none") {
    return "index-only";
  }

  if (hasWebIntent) {
    return "freshness";
  }

  return weakLocalEvidence ? "weak-local" : "local-first";
}

function groupDroppedIds(source: RetrievedChunk[], included: RetrievedChunk[]): string[] {
  const includedIds = new Set(included.map((chunk) => chunk.id));

  return source.filter((chunk) => !includedIds.has(chunk.id)).map((chunk) => chunk.id);
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

function droppedIds(
  source: RetrievedChunk[],
  included: RetrievedChunk[],
  seen: Set<string>,
): string[] {
  const includedIds = new Set(included.map((chunk) => chunk.id));

  return source
    .filter((chunk) => !includedIds.has(chunk.id) && !seen.has(chunk.id))
    .map((chunk) => chunk.id);
}

function estimateChunksTokens(chunks: RetrievedChunk[]): number {
  return chunks.reduce((total, chunk) => total + estimateTextTokens(chunk.text), 0);
}
