export const WEB_QUERY_INTENTS = ["academic", "code", "news", "encyclopedic", "general"] as const;

export type WebQueryIntent = (typeof WEB_QUERY_INTENTS)[number];

export function isWebQueryIntent(value: unknown): value is WebQueryIntent {
  return typeof value === "string" && (WEB_QUERY_INTENTS as readonly string[]).includes(value);
}

interface IntentRule {
  intent: Exclude<WebQueryIntent, "general">;
  patterns: RegExp[];
}

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
