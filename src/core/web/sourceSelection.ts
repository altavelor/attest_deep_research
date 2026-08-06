import type { WebQueryLanguage } from "./queryContext";
import type { WebQueryIntent } from "./queryPlanning";
import type { WebSourceActivation, WebSourceCategory, WebSourceDescriptor } from "./webSources";

export type WebSelectionMode = "instant" | "thinking";

export interface WebSourceCandidate {
  descriptor: WebSourceDescriptor;
  activation: WebSourceActivation;
}

export type WebSourceExclusionReason = "disabled" | "instant-specialized" | "no-search-capability";

export interface WebSourceSelectionInput {
  mode: WebSelectionMode;

  intent?: WebQueryIntent;
  language?: WebQueryLanguage;
}

export interface WebSourceSelectionEntry {
  sourceId: string;
  activation: WebSourceActivation;
}

export interface WebSourceExclusion extends WebSourceSelectionEntry {
  reason: WebSourceExclusionReason;
}

export interface WebSourceSelection {
  ordered: WebSourceCandidate[];
  excluded: WebSourceExclusion[];
}

const INSTANT_CATEGORIES: readonly WebSourceCategory[] = ["serp", "neural"];

const INTENT_STRENGTHS: Record<WebQueryIntent, readonly string[]> = {
  academic: ["papers", "preprints", "citations-graph", "biomed", "metadata"],
  code: ["code", "qa", "troubleshooting", "repositories", "tech-news"],
  news: ["news", "fresh"],
  encyclopedic: ["facts", "definitions", "overview"],
  general: ["general"],
};

const INTENT_CATEGORIES: Record<WebQueryIntent, readonly WebSourceCategory[]> = {
  academic: ["academic"],
  code: ["community"],
  news: ["news"],
  encyclopedic: ["encyclopedia"],
  general: ["serp", "neural"],
};

/**
 * Applies the mode-dependent source policy. Instant queries every non-specialized
 * source without ranking; Thinking keeps the whole enabled pool and lets intent and
 * language decide the order only. Sources marked `always` are never excluded and
 * always lead the order.
 */
export function selectWebSources(
  candidates: readonly WebSourceCandidate[],
  input: WebSourceSelectionInput,
): WebSourceSelection {
  const ordered: WebSourceCandidate[] = [];
  const excluded: WebSourceExclusion[] = [];

  const scored: Array<{ candidate: WebSourceCandidate; score: number; order: number }> = [];

  candidates.forEach((candidate, order) => {
    const entry = { sourceId: candidate.descriptor.id, activation: candidate.activation };

    if (candidate.activation === "off") {
      excluded.push({ ...entry, reason: "disabled" });
      return;
    }
    if (candidate.descriptor.capabilities?.search === false) {
      excluded.push({ ...entry, reason: "no-search-capability" });
      return;
    }
    if (
      input.mode === "instant" &&
      candidate.activation !== "always" &&
      !INSTANT_CATEGORIES.includes(candidate.descriptor.category)
    ) {
      excluded.push({ ...entry, reason: "instant-specialized" });
      return;
    }

    scored.push({ candidate, score: rankingScore(candidate, input), order });
  });

  scored.sort((left, right) => right.score - left.score || left.order - right.order);
  ordered.push(...scored.map((entry) => entry.candidate));

  return { ordered, excluded };
}

/**
 * Higher is queried earlier. `always` outranks everything; intent and language
 * matches only reshuffle the remaining sources, they never remove one.
 */
function rankingScore(candidate: WebSourceCandidate, input: WebSourceSelectionInput): number {
  let score = candidate.activation === "always" ? 1_000 : 0;

  if (input.mode === "instant") {
    return score;
  }

  const { descriptor } = candidate;
  const intent = input.intent;

  if (intent) {
    const wanted = INTENT_STRENGTHS[intent];
    if (descriptor.strengths.some((strength) => wanted.includes(strength))) {
      score += 100;
    }
    if (INTENT_CATEGORIES[intent].includes(descriptor.category)) {
      score += 50;
    }
    if (intent !== "general" && descriptor.strengths.includes("general")) {
      score += 20;
    }
  }

  if (input.language && descriptor.languages !== undefined) {
    score += descriptor.languages.includes(input.language) ? 10 : -10;
  }

  return score;
}
