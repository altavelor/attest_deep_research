import type { ResearchDiscovery, ResearchNote } from "./discoveryTypes";
import { boundNotes, currentHypotheses } from "./discovery";

export const MAX_RESEARCH_HYPOTHESES = 10;
export const MAX_RESEARCH_TESTS = 8;
export const MAX_RESEARCH_OBSERVATIONS = 8;
export const MAX_TEST_FINDING_CHARS = 600;
export const MAX_TEST_FINDING_TOKENS = 4;
export const MAX_DISCOVERY_TEXT_CHARS = 200;
export const MAX_NOTE_TEXT_CHARS = 80;
export const MAX_OBSERVATION_QUOTE_CHARS = 300;
export const MAX_OBSERVATION_TOKENS = 2;
export const MAX_NOTE_TOKENS = 1;
export const MAX_DISCOVERY_OMISSIONS = 8;
export const MAX_DISCOVERY_BYTES = 150 * 1024;

/** Returns the UTF-8 size of the discovery state as it is stored. */
export function discoveryBytes(discovery: ResearchDiscovery): number {
  return new TextEncoder().encode(JSON.stringify(discovery)).length;
}

/** Bounds a model or user text to a stored discovery field: whitespace collapsed, length cut. */
export function discoveryText(text: string, max: number = MAX_DISCOVERY_TEXT_CHARS): string {
  const bounded = text.replace(/\s+/gu, " ").trim().slice(0, max);
  const last = bounded.charCodeAt(bounded.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? bounded.slice(0, -1) : bounded;
}

/**
 * Bounds the notes of a discovery before it is written: at most 50, oldest first dropped except
 * those referenced by a current hypothesis, and then oldest first until the encoded discovery fits
 * `MAX_DISCOVERY_BYTES`. Every other field is already bounded so that it fits without notes.
 */
export function boundDiscovery(discovery: ResearchDiscovery): ResearchDiscovery {
  const current = new Set(
    currentHypotheses(discovery.hypotheses).flatMap((hypothesis) => hypothesis.observationIds),
  );
  const referenced = new Set(
    discovery.observations
      .filter((observation) => current.has(observation.observationId))
      .flatMap((observation) => observation.citationTokens),
  );
  let notes: ResearchNote[] = boundNotes(discovery.notes, referenced);
  let bounded = { ...discovery, notes };
  while (notes.length > 0 && discoveryBytes(bounded) > MAX_DISCOVERY_BYTES) {
    notes = notes.slice(1);
    bounded = { ...discovery, notes };
  }
  return bounded;
}
