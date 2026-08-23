import { RetrievedChunk, SourceKind, SourceReference } from "@core/model/source";
import type { ResearchAnswer } from "@core/answer";
import type { AnswerDiagnostics } from "@core/diagnostics";
import { normalizeCitationDensityWithDiagnostics } from "@core/research/citationDensity";
import {
  analyzeAnswerText,
  markdownCitationOccurrences,
  replaceMarkdownCitationTokens,
} from "@core/research/answerAnalysis";

export type ConversationSourceStatus = "active" | "superseded" | "unavailable";

const MAX_CATALOG_TITLE_CHARACTERS = 160;
const MAX_CATALOG_TOPIC_CHARACTERS = 48;
const MAX_RELEVANCE_CHARACTERS_PER_REVISION = 4_096;
const MIN_REVISION_SEARCH_SLOT_CHARACTERS = 64;

export interface ConversationSourceRegistry {
  sources: ConversationSource[];
}

export interface ConversationSource {
  id: string;
  identity: { kind: SourceKind; canonicalKey: string };
  title: string;
  revisions: ConversationEvidenceRevision[];
}

export interface ConversationEvidenceRevision {
  id: string;
  contentHash: string;
  capturedAt: string;
  chunks: RetrievedChunk[];
  status: ConversationSourceStatus;
  usages: ConversationSourceRevisionUsage[];
}

export interface ConversationSourceRevisionUsage {
  messageId: string;
  citationOffsets: number[];
}

export interface ConversationRegistryCatalogEntry {
  sourceId: string;
  title: string;
  kind: SourceKind;
  canonicalKey: string;
  revisions: Array<{
    revisionId: string;
    status: ConversationSourceStatus;
    capturedAt: string;
    topics: string[];
  }>;
}

export interface ConversationRegistryPromptView {
  catalog: ConversationRegistryCatalogEntry[];
  catalogText: string;
  relevantEvidence: RetrievedChunk[];
}

export function createConversationSourceRegistry(): ConversationSourceRegistry {
  return { sources: [] };
}

export function registerConversationEvidence(
  registry: ConversationSourceRegistry,
  evidence: readonly RetrievedChunk[],
  capturedAt: string,
): { registry: ConversationSourceRegistry; revisionIdByEvidenceId: Map<string, string> } {
  let sources = registry.sources;
  const revisionIdByEvidenceId = new Map<string, string>();
  const freshEvidence: RetrievedChunk[] = [];
  for (const chunk of evidence) {
    const existingRevision = findRevision({ sources }, chunk.id);
    if (existingRevision) {
      revisionIdByEvidenceId.set(chunk.id, existingRevision.id);
    } else {
      freshEvidence.push(chunk);
    }
  }
  const chunksByIdentity = groupByIdentity(freshEvidence);

  for (const [identityKey, chunks] of chunksByIdentity) {
    const first = chunks[0];
    const contentHash = chunks
      .map((chunk) => chunk.contentHash)
      .sort()
      .join("|");
    const sourceIndex = sources.findIndex(
      (candidate) =>
        sourceIdentityKey(candidate.identity.kind, candidate.identity.canonicalKey) === identityKey,
    );
    if (sourceIndex < 0) {
      const sourceId = nextSourceId({ sources });
      const source: ConversationSource = {
        id: sourceId,
        identity: { kind: first.source.kind, canonicalKey: canonicalSourceKey(first.source) },
        title: first.source.title,
        revisions: [
          {
            id: `${sourceId}:revision-1`,
            contentHash,
            capturedAt,
            chunks: chunks.map(cloneChunk),
            status: "active",
            usages: [],
          },
        ],
      };
      sources = [...sources, source];
      for (const chunk of chunks) revisionIdByEvidenceId.set(chunk.id, source.revisions[0].id);
      continue;
    }

    const source = sources[sourceIndex];
    const existing = source.revisions.find(
      (candidate) => candidate.status === "active" && candidate.contentHash === contentHash,
    );
    if (existing) {
      for (const chunk of chunks) revisionIdByEvidenceId.set(chunk.id, existing.id);
      continue;
    }

    const revisions: ConversationEvidenceRevision[] = source.revisions.map((candidate) =>
      candidate.status === "active" ? { ...candidate, status: "superseded" } : candidate,
    );
    const revision: ConversationEvidenceRevision = {
      id: nextRevisionId(source),
      contentHash,
      capturedAt,
      chunks: chunks.map(cloneChunk),
      status: "active",
      usages: [],
    };
    const updatedSource = { ...source, revisions: [...revisions, revision] };
    sources = sources.map((candidate, index) =>
      index === sourceIndex ? updatedSource : candidate,
    );

    for (const chunk of chunks) {
      revisionIdByEvidenceId.set(chunk.id, revision.id);
    }
  }

  return {
    registry: sources === registry.sources ? registry : { sources },
    revisionIdByEvidenceId,
  };
}

export function recordConversationCitationUsages(
  registry: ConversationSourceRegistry,
  messageId: string,
  answerText: string,
  revisionIdByEvidenceId: ReadonlyMap<string, string> = new Map(),
): ConversationSourceRegistry {
  const offsetsByRevision = new Map<string, number[]>();
  const revisionIds = new Set<string>();
  for (const source of registry.sources) {
    for (const revision of source.revisions) revisionIds.add(revision.id);
  }
  const allowedLabels = new Set([...revisionIds, ...revisionIdByEvidenceId.keys()]);
  for (const occurrence of markdownCitationOccurrences(answerText, allowedLabels)) {
    const revisionId = revisionIdByEvidenceId.get(occurrence.label) ?? occurrence.label;
    if (!revisionIds.has(revisionId)) continue;
    const offsets = offsetsByRevision.get(revisionId) ?? [];
    offsets.push(occurrence.index);
    offsetsByRevision.set(revisionId, offsets);
  }

  if (offsetsByRevision.size === 0) return registry;
  const sources = registry.sources.map((source) => {
    const revisions = source.revisions.map((revision) => {
      const citationOffsets = offsetsByRevision.get(revision.id);
      if (!citationOffsets?.length) return revision;
      return { ...revision, usages: [...revision.usages, { messageId, citationOffsets }] };
    });
    return revisions.every((revision, index) => revision === source.revisions[index])
      ? source
      : { ...source, revisions };
  });
  return { sources };
}

export function bindAnswerToConversationRegistry(
  answer: ResearchAnswer,
  registry: ConversationSourceRegistry,
  revisionIdByEvidenceId: ReadonlyMap<string, string>,
): ResearchAnswer {
  const remappedText = replaceMarkdownCitationTokens(answer.answer, revisionIdByEvidenceId);
  const registryRevisionIds = new Set(
    registry.sources.flatMap((source) => source.revisions.map((revision) => revision.id)),
  );
  const density = normalizeCitationDensityWithDiagnostics(remappedText, registryRevisionIds);
  const rewrittenText = density.text;
  const citedRevisionIds = new Set(
    markdownCitationOccurrences(rewrittenText, registryRevisionIds).map(({ label }) => label),
  );
  const citationsByRevision = new Map<string, ResearchAnswer["citations"][number]>();
  for (const citation of answer.citations) {
    const revisionId = revisionIdByEvidenceId.get(citation.id) ?? citation.id;
    if (!citedRevisionIds.has(revisionId) || citationsByRevision.has(revisionId)) continue;
    citationsByRevision.set(revisionId, {
      ...citation,
      id: revisionId,
      source: { ...citation.source, id: revisionId },
    });
  }

  const evidence = [...citedRevisionIds]
    .map((revisionId) => findRevision(registry, revisionId))
    .filter((revision): revision is ConversationEvidenceRevision => revision !== undefined)
    .map((revision) => revisionAsEvidence(revision));

  const answerDiagnostics = answer.contextDiagnostics?.answer;
  const contextDiagnostics = answer.contextDiagnostics
    ? {
        ...answer.contextDiagnostics,
        ...(answerDiagnostics
          ? {
              answer: rebuildVisibleDiagnostics(
                answerDiagnostics,
                rewrittenText,
                revisionIdByEvidenceId,
                density.removedOccurrences,
              ),
            }
          : {}),
      }
    : undefined;

  return {
    ...answer,
    answer: rewrittenText,
    citations: [...citationsByRevision.values()],
    evidence,
    ...(contextDiagnostics ? { contextDiagnostics } : {}),
  };
}

function rebuildVisibleDiagnostics(
  previous: AnswerDiagnostics,
  text: string,
  revisionIdByEvidenceId: ReadonlyMap<string, string>,
  additionallyCollapsed: number,
): AnswerDiagnostics {
  const promptSourceIds = [
    ...new Set(
      [
        ...revisionIdByEvidenceId.values(),
        ...Object.keys(previous.citations.byLabel),
        ...previous.citations.uncitedPromptSourceIds,
      ].map((id) => revisionIdByEvidenceId.get(id) ?? id),
    ),
  ];
  const analysis = analyzeAnswerText(text, new Set(promptSourceIds));
  const occurrences = analysis.occurrences.length;
  return {
    characters: analysis.characters,
    words: analysis.words,
    sentences: analysis.sentences,
    citations: {
      ...previous.citations,
      occurrences,
      uniqueLabels: Object.keys(analysis.byLabel).length,
      per100Words:
        analysis.words === 0 ? 0 : Number(((occurrences * 100) / analysis.words).toFixed(2)),
      sentenceCoverage:
        analysis.sentences === 0
          ? 0
          : Number(((analysis.citedSentences * 100) / analysis.sentences).toFixed(2)),
      maxLabelsPerSentence: analysis.maxLabelsPerSentence,
      byLabel: analysis.byLabel,
      uncitedPromptSourceIds: promptSourceIds.filter((id) => analysis.byLabel[id] === undefined),
      collapsedOccurrences: previous.citations.collapsedOccurrences + additionallyCollapsed,
      unverifiedCitations: [
        ...new Set(
          previous.citations.unverifiedCitations.map((id) => revisionIdByEvidenceId.get(id) ?? id),
        ),
      ],
    },
  };
}

export function selectConversationRegistryPromptView(
  registry: ConversationSourceRegistry,
  question: string,
  maximumRevisions = 6,
  maximumEvidenceCharacters = 12_000,
  maximumCatalogCharacters = 6_000,
): ConversationRegistryPromptView {
  const queryTokens = wordTokens(question);
  const candidates = registry.sources.flatMap((source) =>
    source.revisions.map((revision) => ({
      source,
      revision,
      score: relevanceScore(revision, queryTokens),
      explicitRank: mentionsRegistryId(question, revision.id)
        ? 2
        : mentionsRegistryId(question, source.id)
          ? 1
          : 0,
    })),
  );
  const selected = candidates
    .filter((candidate) => candidate.explicitRank > 0 || candidate.score > 0)
    .sort(
      (left, right) =>
        right.explicitRank - left.explicitRank ||
        Number(right.revision.status === "active") - Number(left.revision.status === "active") ||
        right.score - left.score ||
        latestUsage(right.revision).localeCompare(latestUsage(left.revision)) ||
        right.revision.capturedAt.localeCompare(left.revision.capturedAt),
    )
    .slice(0, Math.max(0, maximumRevisions));
  const relevantEvidence: RetrievedChunk[] = [];
  let remainingCharacters = Math.max(0, maximumEvidenceCharacters);
  for (const { revision } of selected) {
    if (remainingCharacters === 0) break;
    const evidence = revisionAsEvidence(revision, remainingCharacters);
    relevantEvidence.push(evidence);
    remainingCharacters -= evidence.text.length;
  }

  const { catalog, catalogText } = buildPromptCatalog(
    registry,
    question,
    Math.max(0, maximumCatalogCharacters),
  );

  return {
    catalog,
    catalogText,
    relevantEvidence,
  };
}

function buildPromptCatalog(
  registry: ConversationSourceRegistry,
  question: string,
  maximumCharacters: number,
): { catalog: ConversationRegistryCatalogEntry[]; catalogText: string } {
  const explicitRevisionIds = new Set(
    registry.sources.flatMap((source) =>
      source.revisions
        .filter((revision) => mentionsRegistryId(question, revision.id))
        .map((revision) => revision.id),
    ),
  );
  const orderedSources = registry.sources
    .map((source, index) => ({
      source,
      index,
      explicit:
        mentionsRegistryId(question, source.id) ||
        source.revisions.some((revision) => explicitRevisionIds.has(revision.id)),
    }))
    .sort(
      (left, right) => Number(right.explicit) - Number(left.explicit) || left.index - right.index,
    );
  const catalog: ConversationRegistryCatalogEntry[] = [];
  const sections: string[] = [];
  let usedCharacters = 0;

  for (const { source, explicit } of orderedSources) {
    const separatorLength = sections.length === 0 ? 0 : 2;
    const sourcePrefix = `[${source.id}] `;
    const sourceSuffix = ` (${source.identity.kind})`;
    const sourceBudget = maximumCharacters - usedCharacters - separatorLength;
    const requiredRevisionLength = source.revisions
      .filter((revision) => explicitRevisionIds.has(revision.id))
      .reduce((total, revision) => total + 1 + `- ${revision.id}: ${revision.status}`.length, 0);
    if (sourceBudget < sourcePrefix.length + sourceSuffix.length && !explicit) continue;
    const title = truncateToLength(
      promptSafeCatalogText(source.title),
      Math.max(
        0,
        Math.min(
          MAX_CATALOG_TITLE_CHARACTERS,
          sourceBudget - sourcePrefix.length - sourceSuffix.length - requiredRevisionLength,
        ),
      ),
    );
    const sourceLine = `${sourcePrefix}${title}${sourceSuffix}`;
    if (sourceLine.length + separatorLength > maximumCharacters) continue;

    const revisions = [...source.revisions].sort(
      (left, right) =>
        Number(explicitRevisionIds.has(right.id)) - Number(explicitRevisionIds.has(left.id)) ||
        Number(right.status === "active") - Number(left.status === "active") ||
        right.capturedAt.localeCompare(left.capturedAt),
    );
    const includedRevisions: ConversationRegistryCatalogEntry["revisions"] = [];
    const lines = [sourceLine];
    let sectionLength = sourceLine.length;
    for (const [revisionIndex, revision] of revisions.entries()) {
      const required = explicitRevisionIds.has(revision.id);
      const prefix = `- ${revision.id}: ${revision.status}`;
      const available = maximumCharacters - usedCharacters - separatorLength - sectionLength - 1;
      if (available < prefix.length) {
        if (required) continue;
        break;
      }
      const rawTopics = topicsForRevision(revision);
      const topicSuffix = rawTopics.length > 0 ? `; ${rawTopics.join(", ")}` : "";
      const futureRequiredLength = revisions
        .slice(revisionIndex + 1)
        .filter((candidate) => explicitRevisionIds.has(candidate.id))
        .reduce(
          (total, candidate) => total + 1 + `- ${candidate.id}: ${candidate.status}`.length,
          0,
        );
      const suffix = truncateToLength(
        topicSuffix,
        Math.max(0, available - prefix.length - futureRequiredLength),
      );
      lines.push(prefix + suffix);
      sectionLength += 1 + prefix.length + suffix.length;
      includedRevisions.push({
        revisionId: revision.id,
        status: revision.status,
        capturedAt: revision.capturedAt,
        topics: suffix ? rawTopics : [],
      });
    }
    if (includedRevisions.length === 0 && source.revisions.length > 0 && !explicit) continue;
    const section = lines.join("\n");
    sections.push(section);
    usedCharacters += separatorLength + section.length;
    catalog.push({
      sourceId: source.id,
      title,
      kind: source.identity.kind,
      canonicalKey: truncateToLength(source.identity.canonicalKey, 240),
      revisions: includedRevisions,
    });
  }

  return { catalog, catalogText: sections.join("\n\n") };
}

function truncateToLength(value: string, maximumCharacters: number): string {
  if (value.length <= maximumCharacters) return value;
  if (maximumCharacters <= 0) return "";
  if (maximumCharacters === 1) return "…";
  return `${value.slice(0, maximumCharacters - 1).trimEnd()}…`;
}

function promptSafeCatalogText(value: string): string {
  return value
    .replace(/[<>&"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionsRegistryId(text: string, id: string): boolean {
  let index = text.indexOf(id);
  while (index >= 0) {
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + id.length] ?? "";
    if (!/[\p{L}\p{N}:-]/u.test(before) && !/[\p{L}\p{N}:-]/u.test(after)) return true;
    index = text.indexOf(id, index + id.length);
  }
  return false;
}

export function canonicalSourceKey(source: SourceReference): string {
  if (source.kind !== "web") return source.path;
  try {
    const url = new URL(source.url);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^(?:www|m)\./u, "");
    if (url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1) || "/";
    return url.toString();
  } catch {
    return source.url;
  }
}

function cloneChunk(chunk: RetrievedChunk): RetrievedChunk {
  return { ...chunk, source: { ...chunk.source } } as RetrievedChunk;
}

function groupByIdentity(chunks: readonly RetrievedChunk[]): Map<string, RetrievedChunk[]> {
  const grouped = new Map<string, RetrievedChunk[]>();
  for (const chunk of chunks) {
    const key = sourceIdentityKey(chunk.source.kind, canonicalSourceKey(chunk.source));
    const existing = grouped.get(key) ?? [];
    existing.push(chunk);
    grouped.set(key, existing);
  }
  return grouped;
}

function sourceIdentityKey(kind: SourceKind, canonicalKey: string): string {
  return `${kind}:${canonicalKey}`;
}

function nextSourceId(registry: ConversationSourceRegistry): string {
  const used = new Set(registry.sources.map((source) => source.id));
  for (let sequence = 1; ; sequence += 1) {
    const candidate = `source-${sequence}`;
    if (!used.has(candidate)) return candidate;
  }
}

function nextRevisionId(source: ConversationSource): string {
  const used = new Set(source.revisions.map((revision) => revision.id));
  for (let sequence = 1; ; sequence += 1) {
    const candidate = `${source.id}:revision-${sequence}`;
    if (!used.has(candidate)) return candidate;
  }
}

function relevanceScore(
  revision: ConversationEvidenceRevision,
  queryTokens: readonly string[],
): number {
  const searchable = buildBoundedRevisionSearchText(
    revision,
    MAX_RELEVANCE_CHARACTERS_PER_REVISION,
  ).toLowerCase();
  return queryTokens.reduce((score, token) => score + (searchable.includes(token) ? 1 : 0), 0);
}

function wordTokens(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
}

function revisionAsEvidence(
  revision: ConversationEvidenceRevision,
  maximumCharacters = Number.POSITIVE_INFINITY,
): RetrievedChunk {
  const first = revision.chunks[0];
  return {
    id: revision.id,
    text: boundedText(revisionTextParts(revision), maximumCharacters, "\n\n"),
    contentHash: revision.contentHash,
    score: 1,
    source: { ...first.source, id: revision.id },
  };
}

function latestUsage(revision: ConversationEvidenceRevision): string {
  return revision.usages.at(-1)?.messageId ?? "";
}

function findRevision(
  registry: ConversationSourceRegistry,
  revisionId: string,
): ConversationEvidenceRevision | undefined {
  for (const source of registry.sources) {
    const revision = source.revisions.find((candidate) => candidate.id === revisionId);
    if (revision) return revision;
  }
  return undefined;
}

function topicsForRevision(revision: ConversationEvidenceRevision): string[] {
  return wordTokens(buildBoundedRevisionSearchText(revision, MAX_RELEVANCE_CHARACTERS_PER_REVISION))
    .slice(0, 6)
    .map((topic) => truncateToLength(topic, MAX_CATALOG_TOPIC_CHARACTERS));
}

export function buildBoundedRevisionSearchText(
  revision: ConversationEvidenceRevision,
  maximumCharacters: number,
): string {
  let remaining = Math.max(0, maximumCharacters);
  if (remaining === 0 || revision.chunks.length === 0) return "";
  const slotCount = Math.min(
    revision.chunks.length,
    Math.max(1, Math.floor(remaining / MIN_REVISION_SEARCH_SLOT_CHARACTERS)),
  );
  const parts: string[] = [];
  for (let slot = 0; slot < slotCount && remaining > 0; slot += 1) {
    const chunkIndex =
      slotCount === 1 ? 0 : Math.round((slot * (revision.chunks.length - 1)) / (slotCount - 1));
    const chunk = revision.chunks[chunkIndex];
    const separator = parts.length === 0 ? "" : " ";
    const slotsRemaining = slotCount - slot;
    const contentBudget = Math.max(0, Math.floor((remaining - separator.length) / slotsRemaining));
    const titleBudget = Math.min(80, Math.floor(contentBudget / 4));
    const textBudget = Math.max(0, contentBudget - titleBudget - (titleBudget > 0 ? 1 : 0));
    const title = chunk.source.title.slice(0, titleBudget);
    const text = chunk.text.slice(0, textBudget);
    parts.push(`${separator}${title}${title && text ? " " : ""}${text}`.slice(0, remaining));
    remaining -= parts.at(-1)!.length;
  }
  return parts.join("");
}

function* revisionTextParts(revision: ConversationEvidenceRevision): Generator<string> {
  for (const chunk of revision.chunks) yield chunk.text;
}

function boundedText(
  parts: Iterable<string>,
  maximumCharacters: number,
  separator: string,
): string {
  let remaining = Math.max(0, maximumCharacters);
  const bounded: string[] = [];
  const iterator = parts[Symbol.iterator]();
  while (remaining > 0) {
    const next = iterator.next();
    if (next.done) break;
    if (bounded.length > 0) {
      const boundedSeparator = separator.slice(0, remaining);
      bounded.push(boundedSeparator);
      remaining -= boundedSeparator.length;
      if (remaining === 0) break;
    }
    const part = next.value.slice(0, remaining);
    bounded.push(part);
    remaining -= part.length;
  }
  return bounded.join("");
}
