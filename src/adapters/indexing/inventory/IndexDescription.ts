import type { IndexProfile } from "../store/FileVectorIndexFormat";
import type { LanguageInventoryItem } from "../../../core/model/citation";
import type { SourceKind } from "../../../core/model/source";
import { stableId } from "../../extractors/common";
import type { IndexDescriptionPromptContext } from "../../../core/diagnostics";

export const INDEX_DESCRIPTION_ALGORITHM_VERSION = 1;
export const INDEX_DESCRIPTION_MAX_CHARACTERS = 2_000;
export const INDEX_DESCRIPTION_MAX_REPRESENTATIVE_CHUNKS = 12;
export const INDEX_DESCRIPTION_MAX_SAMPLE_CHARACTERS = 180;
export const INDEX_DESCRIPTION_MAX_TOPICS = 12;

export interface IndexDescriptionDiagnostics {
  representativeChunkCount: number;
  truncated: boolean;
  usedFallback: boolean;
  failureReason?: string;
}

export interface IndexDescription {
  text: string;
  generatedAt: string;
  indexUpdatedAt: string;
  generator: "deterministic";
  algorithmVersion: number;
  status: "current" | "stale" | "failed";
  sourceCount: number;
  chunkCount: number;
  diagnostics: IndexDescriptionDiagnostics;
}

export interface IndexDescriptionRepresentativeChunk {
  path: string;
  title: string;
  headingPath: string[];
  text: string;
  kind: SourceKind;
}

export interface IndexDescriptionSource {
  indexUpdatedAt: string;
  sourceCount: number;
  chunkCount: number;
  sourceKinds: readonly SourceKind[];
  languageInventory: LanguageInventoryItem[];
  representativeChunks: IndexDescriptionRepresentativeChunk[];
}

export function buildIndexDescription(
  profile: IndexProfile,
  source: IndexDescriptionSource,
  generatedAt: string,
): IndexDescription {
  const samples = source.representativeChunks
    .slice()
    .sort((left, right) =>
      `${left.path}\n${left.headingPath.join("/")}\n${left.title}`.localeCompare(
        `${right.path}\n${right.headingPath.join("/")}\n${right.title}`,
      ),
    )
    .slice(0, INDEX_DESCRIPTION_MAX_REPRESENTATIVE_CHUNKS);
  const topics = representativeTopics(samples);
  const sections = [
    profileSummary(profile),
    `The committed index contains ${source.sourceCount} sources and ${source.chunkCount} chunks.`,
    `Source types: ${sortedUnique(source.sourceKinds).join(", ") || "unknown"}.`,
    `Languages: ${formatLanguages(source.languageInventory)}.`,
    samples.length > 0
      ? `Representative sources:\n${samples.map(formatSample).join("\n")}`
      : "Representative sources: none available.",
    topics.length > 0 ? `Representative topics: ${topics.join(", ")}.` : "",
  ].filter(Boolean);
  const unbounded = sections.join("\n");
  const text = truncate(unbounded, INDEX_DESCRIPTION_MAX_CHARACTERS);

  return {
    text,
    generatedAt,
    indexUpdatedAt: source.indexUpdatedAt,
    generator: "deterministic",
    algorithmVersion: INDEX_DESCRIPTION_ALGORITHM_VERSION,
    status: "current",
    sourceCount: source.sourceCount,
    chunkCount: source.chunkCount,
    diagnostics: {
      representativeChunkCount: samples.length,
      truncated: text.length < unbounded.length,
      usedFallback: false,
    },
  };
}

export function buildMinimalIndexDescription(
  profile: IndexProfile,
  input: {
    generatedAt: string;
    indexUpdatedAt: string;
    sourceCount: number;
    chunkCount: number;
    failureReason?: string;
  },
): IndexDescription {
  const text = truncate(
    `${profileSummary(profile)} The committed index contains ${input.sourceCount} sources and ${input.chunkCount} chunks.`,
    INDEX_DESCRIPTION_MAX_CHARACTERS,
  );

  return {
    text,
    generatedAt: input.generatedAt,
    indexUpdatedAt: input.indexUpdatedAt,
    generator: "deterministic",
    algorithmVersion: INDEX_DESCRIPTION_ALGORITHM_VERSION,
    status: input.failureReason ? "failed" : "current",
    sourceCount: input.sourceCount,
    chunkCount: input.chunkCount,
    diagnostics: {
      representativeChunkCount: 0,
      truncated: false,
      usedFallback: true,
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    },
  };
}

export function resolveIndexDescriptionForPrompt(
  profile: IndexProfile,
): IndexDescriptionPromptContext {
  const persisted = profile.indexDescription;
  const freshness = persisted?.status ?? "missing";
  const description =
    persisted && persisted.status !== "stale"
      ? persisted
      : buildMinimalIndexDescription(profile, {
        generatedAt: persisted?.generatedAt ?? profile.lastIndexedAt ?? profile.updatedAt,
        indexUpdatedAt: profile.lastIndexedAt ?? persisted?.indexUpdatedAt ?? profile.updatedAt,
        sourceCount: profile.indexedFileCount ?? persisted?.sourceCount ?? 0,
        chunkCount: persisted?.chunkCount ?? 0,
      });

  return {
    text: description.text,
    diagnostics: {
      freshness,
      textHash: stableId(description.text),
      algorithmVersion: description.algorithmVersion,
      generatedAt: description.generatedAt,
      indexUpdatedAt: description.indexUpdatedAt,
      representativeChunkCount: description.diagnostics.representativeChunkCount,
      truncated: description.diagnostics.truncated,
      usedFallback:
        freshness === "stale" || freshness === "missing" || description.diagnostics.usedFallback,
      ...(description.diagnostics.failureReason
        ? { failureReason: description.diagnostics.failureReason }
        : {}),
    },
  };
}

export async function refreshIndexDescriptionAfterRun(
  profile: IndexProfile,
  run: { indexChanged?: boolean; lastIndexedAt?: string },
  loadSource: () => Promise<IndexDescriptionSource>,
  generatedAt: string,
): Promise<IndexDescription> {
  if (run.indexChanged !== true && profile.indexDescription) {
    return profile.indexDescription;
  }

  try {
    return buildIndexDescription(profile, await loadSource(), generatedAt);
  } catch {
    return buildMinimalIndexDescription(profile, {
      generatedAt,
      indexUpdatedAt: run.lastIndexedAt ?? generatedAt,
      sourceCount: profile.indexDescription?.sourceCount ?? profile.indexedFileCount ?? 0,
      chunkCount: profile.indexDescription?.chunkCount ?? 0,
      failureReason: "description-generation-failed",
    });
  }
}

function profileSummary(profile: IndexProfile): string {
  const scope =
    profile.mode === "wholeVault"
      ? "the whole vault"
      : `selected folders (${profile.includeFolders.map(normalizeMetadata).join(", ") || "none"})`;
  const exclusions =
    profile.excludeGlobs.length > 0
      ? profile.excludeGlobs.map(normalizeMetadata).join(", ")
      : "none";
  return `Index "${normalizeMetadata(profile.name)}" covers ${scope}. Exclusions: ${exclusions}.`;
}

function formatLanguages(inventory: LanguageInventoryItem[]): string {
  const languages = inventory
    .slice()
    .sort(
      (left, right) =>
        right.chunkCount - left.chunkCount || left.language.localeCompare(right.language),
    )
    .map((item) => `${normalizeMetadata(item.language)} (${item.chunkCount} chunks)`);
  return languages.join(", ") || "unknown";
}

function formatSample(sample: IndexDescriptionRepresentativeChunk): string {
  const heading =
    sample.headingPath.length > 0
      ? ` > ${sample.headingPath.map(normalizeMetadata).join(" > ")}`
      : "";
  return `- ${normalizeMetadata(sample.path)}${heading} [${sample.kind}]`;
}

function representativeTopics(samples: IndexDescriptionRepresentativeChunk[]): string[] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const text =
      `${sample.title} ${sample.headingPath.join(" ")} ${sample.text.slice(0, INDEX_DESCRIPTION_MAX_SAMPLE_CHARACTERS)}`.toLocaleLowerCase();
    for (const token of text.match(/[\p{L}\p{N}][\p{L}\p{N}_-]{3,}/gu) ?? []) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || left.localeCompare(right),
    )
    .slice(0, INDEX_DESCRIPTION_MAX_TOPICS)
    .map(([topic]) => topic);
}

function sortedUnique<T extends string>(items: readonly T[]): T[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMetadata(value: string): string {
  return normalizeWhitespace(value).replace(/</g, "‹").replace(/>/g, "›");
}

function truncate(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}
