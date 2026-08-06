import type { WebQueryLanguage } from "./queryContext";
import type { WebQueryIntent } from "./queryPlanning";
import type { WebSourceActivation, WebSourceCategory, WebSourceDescriptor } from "./webSources";

export type WebSelectionMode = "instant" | "thinking";

export interface WebSourceCandidate {
  descriptor: WebSourceDescriptor;
  activation: WebSourceActivation;
}

export type WebSourceExclusionReason =
  | "disabled"
  | "instant-specialized"
  | "no-search-capability"
  | "intent-mismatch";

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
  general: ["serp", "neural", "encyclopedia"],
};

const GENERALIST_STRENGTH = "general";

const ALWAYS_BONUS = 1_000;
const TOPIC_WEIGHT = 100;
const GENERALIST_BONUS = 30;
const LANGUAGE_BONUS = 15;
const CATEGORY_CONFIDENCE = 0.5;

interface ScoredCandidate {
  candidate: WebSourceCandidate;
  score: number;
  order: number;
  qualifies: boolean;
}

/**
 * Applies the mode-dependent source policy. Instant queries every non-specialized
 * source without ranking; Thinking ranks the enabled pool by how much of the intent
 * a source covers and drops the sources that cover none of it. Sources marked
 * `always` are never excluded and always lead the order.
 */
export function selectWebSources(
  candidates: readonly WebSourceCandidate[],
  input: WebSourceSelectionInput,
): WebSourceSelection {
  const excluded: WebSourceExclusion[] = [];
  const scored: ScoredCandidate[] = [];

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

    scored.push({ candidate, order, ...evaluate(candidate, input) });
  });

  scored.sort((left, right) => right.score - left.score || left.order - right.order);

  const planned = scored.some((entry) => entry.qualifies)
    ? scored.filter((entry) => {
        if (entry.qualifies) {
          return true;
        }
        excluded.push({
          sourceId: entry.candidate.descriptor.id,
          activation: entry.candidate.activation,
          reason: "intent-mismatch",
        });
        return false;
      })
    : scored;

  return { ordered: planned.map((entry) => entry.candidate), excluded };
}

/**
 * Scores a source on a metric scale and reports whether it carries any signal for
 * the intent. Topical relevance counts once: the share of the intent tags a source
 * covers, falling back to the weaker category prior when no tag matches. A source
 * that covers nothing of a known intent and is no generalist does not qualify.
 */
function evaluate(
  candidate: WebSourceCandidate,
  input: WebSourceSelectionInput,
): { score: number; qualifies: boolean } {
  const forced = candidate.activation === "always";
  const base = forced ? ALWAYS_BONUS : 0;

  if (input.mode === "instant") {
    return { score: base, qualifies: true };
  }

  const { descriptor } = candidate;
  const intent = input.intent;
  const generalist = descriptor.strengths.includes(GENERALIST_STRENGTH);

  let score = base;
  let topicalFit = 0;

  if (intent) {
    topicalFit = topicalFitFor(descriptor.strengths, descriptor.category, intent);
    score += TOPIC_WEIGHT * topicalFit;
  }
  if (generalist) {
    score += GENERALIST_BONUS;
  }

  if (input.language && descriptor.languages !== undefined) {
    score += descriptor.languages.includes(input.language) ? LANGUAGE_BONUS : -LANGUAGE_BONUS;
  }

  return {
    score,
    qualifies: intent === undefined || forced || topicalFit > 0 || generalist,
  };
}

function topicalFitFor(
  strengths: readonly string[],
  category: WebSourceCategory,
  intent: WebQueryIntent,
): number {
  const wanted = INTENT_STRENGTHS[intent];
  const matched = wanted.filter((strength) => strengths.includes(strength)).length;
  const tagFit = wanted.length === 0 ? 0 : matched / wanted.length;
  if (tagFit > 0) {
    return tagFit;
  }
  return INTENT_CATEGORIES[intent].includes(category) ? CATEGORY_CONFIDENCE : 0;
}
