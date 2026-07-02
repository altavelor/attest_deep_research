// Core domain: rule-based web query planning. Pure functions — classification
// of a query into an intent, selection of catalog sources for that intent, and
// reciprocal-rank-fusion merging of per-source result lists.

import { WebSourceDescriptor } from "./webSources";

export const WEB_QUERY_INTENTS = [
  "academic",
  "code",
  "news",
  "encyclopedic",
  "general",
] as const;

export type WebQueryIntent = (typeof WEB_QUERY_INTENTS)[number];

export function isWebQueryIntent(value: unknown): value is WebQueryIntent {
  return typeof value === "string" && (WEB_QUERY_INTENTS as readonly string[]).includes(value);
}

interface IntentRule {
  intent: Exclude<WebQueryIntent, "general">;
  patterns: RegExp[];
}

// Order matters: the first matching rule wins. `\b` is ASCII-only in JS, so
// Cyrillic keywords use bare substring patterns instead of word boundaries.
const INTENT_RULES: IntentRule[] = [
  {
    intent: "academic",
    patterns: [
      /\b(paper|study|arxiv|doi|journal|preprint|peer.?review|citation|dataset)\b/i,
      /исследовани|научн|статья|диссертаци|публикаци/i,
    ],
  },
  {
    intent: "code",
    patterns: [
      /\b(error|exception|stack ?trace|bug|npm|pip|library|framework|api|sdk|typescript|javascript|python|rust|golang|java|compiler|deprecated)\b|`[^`]+`/i,
      /библиотек|ошибк|фреймворк|исходник/i,
    ],
  },
  {
    intent: "news",
    patterns: [
      /\b(news|latest|today|yesterday|this (week|month|year)|announc\w*|releas\w*|launch\w*|price)\b/i,
      /новост|последн|сегодня|вчера|анонс|релиз/i,
    ],
  },
  {
    intent: "encyclopedic",
    patterns: [
      /^(what is|what are|who is|who was|define|definition of)\b/i,
      /^(что такое|кто так|определение)/i,
    ],
  },
];

export function classifyWebQuery(query: string): WebQueryIntent {
  const trimmed = query.trim();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(trimmed))) {
      return rule.intent;
    }
  }
  return "general";
}

/** Descriptor strengths that satisfy each intent, in preference order. */
const INTENT_STRENGTHS: Record<WebQueryIntent, string[]> = {
  academic: ["papers", "preprints", "citations-graph", "biomed", "metadata"],
  code: ["code", "qa", "troubleshooting", "repositories", "tech-news"],
  // Deliberately excludes tech-news/discussions: HN is a strong `code` source
  // but pollutes general-news results with stale tech threads.
  news: ["news", "fresh"],
  encyclopedic: ["facts", "definitions", "overview"],
  general: ["general"],
};

/**
 * Picks up to `maxSources` sources for the intent: first the ones whose
 * strengths match the intent, then general-purpose sources as backfill.
 * Order within each group follows the caller-supplied (catalog) order.
 */
export function selectSourcesForIntent(
  descriptors: readonly WebSourceDescriptor[],
  intent: WebQueryIntent,
  maxSources: number,
): WebSourceDescriptor[] {
  const wanted = new Set(INTENT_STRENGTHS[intent]);
  const matching = descriptors.filter((descriptor) =>
    descriptor.strengths.some((strength) => wanted.has(strength)),
  );
  const backfill = descriptors.filter(
    (descriptor) => !matching.includes(descriptor) && descriptor.strengths.includes("general"),
  );
  return [...matching, ...backfill].slice(0, Math.max(1, maxSources));
}

const RRF_K = 60;

/**
 * Reciprocal rank fusion across per-source ranked lists, deduplicated by
 * normalized URL. First-seen item wins the dedupe; scores accumulate.
 */
export function mergeRankedResults<T>(
  lists: readonly (readonly T[])[],
  getUrl: (item: T) => string,
): T[] {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    list.forEach((item, index) => {
      const key = normalizeUrlForDedupe(getUrl(item));
      const entry = scores.get(key);
      const score = 1 / (RRF_K + index + 1);
      if (entry) {
        entry.score += score;
      } else {
        scores.set(key, { item, score });
      }
    });
  }

  return [...scores.values()].sort((a, b) => b.score - a.score).map((entry) => entry.item);
}

function normalizeUrlForDedupe(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
