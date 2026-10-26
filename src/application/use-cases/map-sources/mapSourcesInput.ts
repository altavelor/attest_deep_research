import {
  MAX_MAP_SOURCES_PATH_CHARS,
  MAX_MAP_SOURCES_QUESTION_CHARS,
  MAX_MAP_SOURCES_ROWS,
} from "@core/research";
import { sha256Hex } from "@shared";

export interface MapSourcesInput {
  question: string;
  sourcePaths?: readonly string[];
  maxSources?: number;
  perSourceRounds?: number;
  signal?: AbortSignal;
}

export interface NormalizedMapSourcesInput {
  question: string;
  sourcePaths: string[];
  maxSources: number;
  perSourceRounds: number;
}

export const DEFAULT_MAX_SOURCES = 8;
export const DEFAULT_PER_SOURCE_ROUNDS = 6;
export const MIN_PER_SOURCE_ROUNDS = 2;
export const MAX_PER_SOURCE_ROUNDS = 12;
export const PER_SOURCE_RESULT_CHARS = 20_000;

/** A map_sources request or batch failure with a safe code and a model-readable message. */
export class MapSourcesFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MapSourcesFailure";
  }
}

/**
 * Bounds and canonicalizes a model-supplied fan-out request: a trimmed question of at most
 * 1000 characters, unique canonical vault paths without traversal, at most 20 sources and
 * a per-source round budget of 2-12. Invalid input is rejected, never repaired silently.
 */
export function normalizeMapSourcesInput(
  input: MapSourcesInput,
  defaultMaxSources = DEFAULT_MAX_SOURCES,
  hardCap = MAX_MAP_SOURCES_ROWS,
): NormalizedMapSourcesInput {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question || question.length > MAX_MAP_SOURCES_QUESTION_CHARS) {
    throw new MapSourcesFailure(
      "invalid-input",
      `question must be 1-${MAX_MAP_SOURCES_QUESTION_CHARS} characters.`,
    );
  }
  const cap = Math.min(hardCap, MAX_MAP_SOURCES_ROWS);
  const maxSources = clamp(input.maxSources ?? defaultMaxSources, 1, cap);
  const perSourceRounds = clamp(
    input.perSourceRounds ?? DEFAULT_PER_SOURCE_ROUNDS,
    MIN_PER_SOURCE_ROUNDS,
    MAX_PER_SOURCE_ROUNDS,
  );
  const sourcePaths: string[] = [];
  for (const raw of input.sourcePaths ?? []) {
    if (typeof raw === "string" && raw.trim() === "") continue;
    const path = canonicalSourcePath(raw);
    if (path === null) {
      throw new MapSourcesFailure(
        "invalid-source-path",
        "sourcePaths must be vault-relative document paths without '..' segments.",
      );
    }
    if (!sourcePaths.includes(path)) sourcePaths.push(path);
  }
  return { question, sourcePaths: sourcePaths.slice(0, maxSources), maxSources, perSourceRounds };
}

/** Returns the canonical vault-relative form of a document path, or null for traversal or overlong paths. */
export function canonicalSourcePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const segments = value
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.includes("..")) return null;
  const path = segments.join("/");
  return path.length <= MAX_MAP_SOURCES_PATH_CHARS && !/[\u0000-\u001f]/u.test(path) ? path : null;
}

/** Derives the stable batch id of one host request id. */
export function batchIdOf(requestId: string): string {
  return `mapbatch-${sha256Hex(requestId).slice(0, 24)}`;
}

/** Derives the stable worker request id of one document of a batch from its canonical path. */
export function workerRequestIdOf(batchId: string, sourcePath: string): string {
  return `${batchId}-${sha256Hex(sourcePath).slice(0, 16)}`;
}

function clamp(value: number, min: number, max: number): number {
  const whole = Number.isFinite(value) ? Math.trunc(value) : min;
  return Math.max(min, Math.min(max, whole));
}
