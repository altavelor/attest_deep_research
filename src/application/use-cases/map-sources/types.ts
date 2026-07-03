// Fan-out over documents (SPEC-corpus R5). One scoped sub-agent per source
// yields a structured stance row; the reduce step is an evidence matrix.

import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";

/** How a single document relates to the fan-out question. */
export type MapSourceStance = "supports" | "opposes" | "mixed" | "not_addressed" | "unclear";

export const MAP_SOURCE_STANCES: readonly MapSourceStance[] = [
  "supports",
  "opposes",
  "mixed",
  "not_addressed",
  "unclear",
];

/** One document's answer to the fan-out question. */
export interface MapSourceRow {
  sourcePath: string;
  ok: boolean;
  stance: MapSourceStance;
  /** 1–4 short findings, each ideally carrying an inline `[evidenceId]` citation. */
  keyFindings: string[];
  /** Evidence ids this document's sub-agent cited (subset of its snapshot). */
  evidenceIds: string[];
  /** The sub-agent's free-text answer (already in the shared citation format). */
  answer: string;
  /** Present when the sub-agent failed; the row is a graceful degradation, not a hard error. */
  error?: string;
  /** Raw evidence gathered by this source's sub-agent, for merging into the parent registry. */
  snapshot: ResearchEvidenceSnapshot;
}

export interface MapSourcesDiagnostics {
  /** How the fanned-out source set was chosen. */
  selection: "explicit" | "relevance";
  requested: number;
  completed: number;
  failed: number;
}

export interface MapSourcesResult {
  question: string;
  rows: MapSourceRow[];
  diagnostics: MapSourcesDiagnostics;
}

export type MapSourcesProgress =
  | { type: "selected"; sourcePaths: readonly string[]; selection: "explicit" | "relevance" }
  | { type: "source-start"; sourcePath: string; index: number; total: number }
  | { type: "source-done"; sourcePath: string; ok: boolean; index: number; total: number };
