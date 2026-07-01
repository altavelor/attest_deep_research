import { DEFAULT_CHUNK_LENGTH, DEFAULT_CHUNK_OVERLAP } from "../extractors/common";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  DEFAULT_PDF_CHUNK_OVERLAP,
  DEFAULT_PDF_CHUNK_SIZE,
  IndexProfile,
} from "../indexing/store/FileVectorIndexStore";
import { ApiFormat } from "@core/agent";
import { isRecord } from "@shared";
import { isNonNegativeInteger, isPositiveInteger } from "@shared";
import {
  INDEX_DESCRIPTION_MAX_CHARACTERS,
  type IndexDescription,
} from "../indexing/inventory/IndexDescription";
import { DEFAULT_INDEX_FOLDER, DEFAULT_INDEX_PROFILE_ID } from "./constants";

export function normalizeListInput(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatListInput(value: string[]): string {
  return value.join("\n");
}

export function normalizeUrl(value: string, fallback: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/\/+$/, "");
}

export function normalizeVaultFolder(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_INDEX_FOLDER;
  }

  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function isSettingsRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeProfileName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function readStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : [...fallback];
}

export function readApiFormat(value: unknown): ApiFormat | null {
  return value === "openai-compatible" || value === "ollama" || value === "anthropic"
    ? value
    : null;
}

export function readActiveIndexProfileId(value: unknown, profiles: IndexProfile[]): string {
  const id = readString(value);

  if (id && profiles.some((profile) => profile.id === id)) {
    return id;
  }

  return profiles[0]?.id ?? DEFAULT_INDEX_PROFILE_ID;
}

export function readPositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}

export function readOptionalPositiveInteger(value: unknown): number | undefined {
  return isPositiveInteger(value) ? value : undefined;
}

export function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readNonNegativeInteger(value: unknown, fallback: number): number {
  return isNonNegativeInteger(value) ? value : fallback;
}

export function readNonNegativeIntegerOrUndefined(value: unknown): number | undefined {
  return isNonNegativeInteger(value) ? value : undefined;
}

export function readIndexDescription(value: unknown): IndexDescription | undefined {
  if (
    !isRecord(value) ||
    typeof value.text !== "string" ||
    value.text.length === 0 ||
    value.text.length > INDEX_DESCRIPTION_MAX_CHARACTERS ||
    typeof value.generatedAt !== "string" ||
    typeof value.indexUpdatedAt !== "string" ||
    value.generator !== "deterministic" ||
    !isPositiveInteger(value.algorithmVersion) ||
    (value.status !== "current" && value.status !== "stale" && value.status !== "failed") ||
    !isNonNegativeInteger(value.sourceCount) ||
    !isNonNegativeInteger(value.chunkCount) ||
    !isRecord(value.diagnostics) ||
    !isNonNegativeInteger(value.diagnostics.representativeChunkCount) ||
    typeof value.diagnostics.truncated !== "boolean" ||
    typeof value.diagnostics.usedFallback !== "boolean" ||
    (value.diagnostics.failureReason !== undefined &&
      typeof value.diagnostics.failureReason !== "string")
  ) {
    return undefined;
  }

  return {
    text: value.text,
    generatedAt: value.generatedAt,
    indexUpdatedAt: value.indexUpdatedAt,
    generator: "deterministic",
    algorithmVersion: value.algorithmVersion,
    status: value.status,
    sourceCount: value.sourceCount,
    chunkCount: value.chunkCount,
    diagnostics: {
      representativeChunkCount: value.diagnostics.representativeChunkCount,
      truncated: value.diagnostics.truncated,
      usedFallback: value.diagnostics.usedFallback,
      ...(typeof value.diagnostics.failureReason === "string"
        ? { failureReason: value.diagnostics.failureReason }
        : {}),
    },
  };
}

export function readIndexMode(value: unknown): IndexProfile["mode"] {
  return value === "selected" ? "selected" : "wholeVault";
}

export function normalizeChunkOverlap(value: number, chunkSize: number): number {
  return Math.max(0, Math.min(value, chunkSize - 1));
}

export function normalizeIndexProfileNumbers(profile: IndexProfile): void {
  const chunkSize = readPositiveInteger(profile.chunkSize, DEFAULT_CHUNK_LENGTH);
  profile.chunkSize = chunkSize;
  profile.chunkOverlap = normalizeChunkOverlap(
    readNonNegativeInteger(profile.chunkOverlap, DEFAULT_CHUNK_OVERLAP),
    chunkSize,
  );
  const pdfChunkSize = readPositiveInteger(profile.pdfChunkSize, DEFAULT_PDF_CHUNK_SIZE);
  profile.pdfChunkSize = pdfChunkSize;
  profile.pdfChunkOverlap = normalizeChunkOverlap(
    readNonNegativeInteger(profile.pdfChunkOverlap, DEFAULT_PDF_CHUNK_OVERLAP),
    pdfChunkSize,
  );
  profile.embeddingBatchSize = readPositiveInteger(
    profile.embeddingBatchSize,
    DEFAULT_EMBEDDING_BATCH_SIZE,
  );
}
