export type HypothesisStatus = "untested" | "supported" | "disconfirmed" | "inconclusive";

export interface ResearchHypothesis {
  hypothesisId: string;
  revision: number;
  previousRevision: number | null;
  branchId: string;
  claim: string;
  alternative: string;
  prediction: string;
  disconfirmation: string;
  status: HypothesisStatus;
  observationIds: readonly string[];
}

export type ResearchTestKind = "literature-check" | "supplied-observation";

export interface ResearchTest {
  testId: string;
  hypothesisId: string;
  hypothesisRevision: number;
  kind: ResearchTestKind;
  method: string;
  status: "proposed" | "awaiting-input" | "observed" | "unavailable";
}

export type ObservationVerdict = "supports" | "contradicts" | "inconclusive";

export interface ResearchObservation {
  observationId: string;
  testId: string;
  producer: "source" | "user";
  citationTokens: readonly string[];
  verdict: ObservationVerdict;
  quote: string | null;
  limitations: readonly string[];
  observedAt: string | null;
  receivedAt: string;
}

export type CycleDecision = "continue" | "await-observation" | "finish" | "exhausted";

export interface ResearchCycle {
  ordinal: number;
  workIds: readonly string[];
  decision: CycleDecision;
  reason: string;
}

export interface ResearchNote {
  sequence: number;
  cycle: number;
  attempted: string;
  outcome: string;
  citationTokens: readonly string[];
  decision: string;
  nextAction: string;
}

export interface ObservationDecisionPayload {
  text: string;
}
