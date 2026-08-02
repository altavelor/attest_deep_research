// Query shaping for image providers. Commons and Openverse match a query against
// short file metadata with AND semantics, so a natural-language research question
// ("схема солнечной системы планеты") matches nothing while its content terms
// alone match plenty. Callers try the variants in order and stop at the first
// that yields candidates.

const MAX_QUERY_LENGTH = 200;
const MAX_CONTENT_TERMS = 4;
const NARROW_TERM_COUNT = 2;

/**
 * Words naming the medium rather than the subject. They are noise for an image
 * index, where every entry is already an image.
 */
const MEDIUM_TERMS = new Set([
  "схема",
  "схемы",
  "схему",
  "диаграмма",
  "диаграммы",
  "картинка",
  "картинки",
  "изображение",
  "изображения",
  "фото",
  "фотография",
  "фотографии",
  "рисунок",
  "иллюстрация",
  "инфографика",
  "diagram",
  "diagrams",
  "chart",
  "charts",
  "scheme",
  "picture",
  "pictures",
  "image",
  "images",
  "photo",
  "photos",
  "photograph",
  "illustration",
  "infographic",
]);

/**
 * Progressively broader forms of an image query: the query as written, then its
 * content terms, then only the most significant ones. Always returns at least
 * one entry, and never repeats a form.
 */
export function imageQueryVariants(query: string): string[] {
  const normalized = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (!normalized) return [];

  const terms = normalized.split(" ");
  const contentTerms = terms.filter((term) => !isMediumTerm(term));
  const effectiveTerms = contentTerms.length > 0 ? contentTerms : terms;

  const variants = [
    normalized,
    effectiveTerms.slice(0, MAX_CONTENT_TERMS).join(" "),
    effectiveTerms.slice(0, NARROW_TERM_COUNT).join(" "),
  ];

  const unique: string[] = [];
  for (const variant of variants) {
    const trimmed = variant.trim();
    if (trimmed && !unique.includes(trimmed)) unique.push(trimmed);
  }
  return unique;
}

function isMediumTerm(term: string): boolean {
  return MEDIUM_TERMS.has(term.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
}
