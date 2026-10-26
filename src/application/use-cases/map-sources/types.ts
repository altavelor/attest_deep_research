import type { ResearchEvidenceSnapshot } from "@application/sources/evidence";
import type { SubAgentTelemetry } from "@application/research/subAgentPort";

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

  subAgents?: SubAgentTelemetry[];
}

export interface MapSourcesResult {
  question: string;
  rows: MapSourceRow[];
  diagnostics: MapSourcesDiagnostics;
}
