import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";

export type MapSourceStance = "supports" | "opposes" | "mixed" | "not_addressed" | "unclear";

export const MAP_SOURCE_STANCES: readonly MapSourceStance[] = [
  "supports",
  "opposes",
  "mixed",
  "not_addressed",
  "unclear",
];

export interface MapSourceRow {
  sourcePath: string;
  ok: boolean;
  stance: MapSourceStance;

  keyFindings: string[];

  evidenceIds: string[];

  answer: string;

  error?: string;

  snapshot: ResearchEvidenceSnapshot;
}

export interface MapSourcesDiagnostics {
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
