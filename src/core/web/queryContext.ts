export const WEB_QUERY_RECENCIES = ["day", "week", "month"] as const;

export type WebQueryRecency = (typeof WEB_QUERY_RECENCIES)[number];

export function isWebQueryRecency(value: unknown): value is WebQueryRecency {
  return typeof value === "string" && (WEB_QUERY_RECENCIES as readonly string[]).includes(value);
}

export type WebQueryLanguage = "en" | "ru";

export function detectQueryLanguage(query: string): WebQueryLanguage {
  return /[Ѐ-ӿ]/.test(query) ? "ru" : "en";
}

interface RecencyRule {
  recency: WebQueryRecency;
  patterns: RegExp[];
}

const RECENCY_RULES: RecencyRule[] = [
  {
    recency: "day",
    patterns: [
      /\b(today|tonight|breaking|(last|past)\s*24\s*hours?)\b/i,
      /сегодня|за сутки|последн\S*\s*24\s*час|за последний день/i,
    ],
  },
  {
    recency: "week",
    patterns: [
      /\b(this|last|past)\s+week\b|\b(last|past)\s*7\s*days\b/i,
      /за неделю|последн\S* недел|на этой неделе/i,
    ],
  },
  {
    recency: "month",
    patterns: [
      /\b(this|last|past)\s+month\b|\b(last|past)\s*30\s*days\b/i,
      /за месяц|последн\S* месяц|в этом месяце/i,
    ],
  },
];

/** Infers a freshness window from the query text; undefined when time-neutral. */
export function inferQueryRecency(query: string): WebQueryRecency | undefined {
  for (const rule of RECENCY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(query))) {
      return rule.recency;
    }
  }
  return undefined;
}

const RECENCY_WINDOW_MS: Record<WebQueryRecency, number> = {
  day: 24 * 60 * 60 * 1_000,
  week: 7 * 24 * 60 * 60 * 1_000,
  month: 30 * 24 * 60 * 60 * 1_000,
};

/** Earliest publication instant that satisfies the recency window. */
export function recencyFloor(recency: WebQueryRecency, now: Date): Date {
  return new Date(now.getTime() - RECENCY_WINDOW_MS[recency]);
}

export interface SiteFilterExtraction {
  query: string;
  domains: string[];
}

/**
 * Pulls `site:example.com` operators out of a query. Keyword APIs treat the
 * operator as literal text (and typically return nothing); sources that have a
 * structured domain filter receive the extracted domains instead.
 */
export function extractSiteFilters(query: string): SiteFilterExtraction {
  const domains: string[] = [];
  const stripped = query
    .replace(/(^|\s)site:(\S+)/gi, (_match, _lead, domain: string) => {
      domains.push(domain.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { query: stripped, domains };
}

const EN_MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";
const RU_MONTHS =
  "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";

/**
 * Removes explicit dates and "today"-style words from a query. Applied only
 * when a structured recency filter is active: models compensate for missing
 * date filters by writing dates into the query text, which keyword APIs then
 * match literally (usually to zero results).
 */
export function stripTemporalNoise(query: string): string {
  const cleaned = query
    .replace(
      new RegExp(`\\b(${EN_MONTHS})\\s+\\d{1,2}(st|nd|rd|th)?(,)?(\\s+20\\d\\d)?\\b`, "gi"),
      " ",
    )
    .replace(
      new RegExp(
        `\\b\\d{1,2}(st|nd|rd|th)?\\s+(${EN_MONTHS}|${RU_MONTHS})(\\s+20\\d\\d)?\\b`,
        "gi",
      ),
      " ",
    )
    .replace(/\b20\d\d-\d\d-\d\d\b/g, " ")
    .replace(/\b(today|yesterday|latest)\b/gi, " ")
    .replace(/сегодня|вчера/gi, " ")
    .replace(/\b20\d\d\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : query.trim();
}
