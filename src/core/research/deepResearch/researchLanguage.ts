import type { ResearchState } from "./types";

export const DEFAULT_RESEARCH_LANGUAGE = "en";

export const RESEARCH_LANGUAGE_RULE =
  "Write every text you produce in the language of the research question. Keep direct quotations and source titles in their original language.";

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/iu;
const MAX_LANGUAGE_TAG_CHARS = 35;

const SCRIPT_LANGUAGES: readonly [RegExp, string][] = [
  [/\p{Script=Cyrillic}/u, "ru"],
  [/\p{Script=Arabic}/u, "ar"],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
  [/\p{Script=Hangul}/u, "ko"],
  [/\p{Script=Han}/u, "zh"],
];

const STOP_WORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  en: new Set(["the", "and", "is", "are", "of", "to", "what", "how", "which", "with", "for"]),
  de: new Set([
    "der",
    "die",
    "das",
    "und",
    "ist",
    "nicht",
    "mit",
    "für",
    "wie",
    "welche",
    "ein",
    "eine",
    "von",
  ]),
  es: new Set(["el", "los", "las", "y", "por", "para", "cómo", "qué", "una", "del", "es", "cuál"]),
  fr: new Set([
    "le",
    "les",
    "et",
    "est",
    "des",
    "une",
    "pour",
    "comment",
    "du",
    "au",
    "avec",
    "quels",
  ]),
};

/** Reads an untrusted language tag: a BCP-47-like tag is returned lower-cased, anything else is null. */
export function normalizeResearchLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tag = value.trim();
  return tag.length <= MAX_LANGUAGE_TAG_CHARS && LANGUAGE_TAG.test(tag) ? tag.toLowerCase() : null;
}

/**
 * Guesses the language of a question without a model: the dominant non-Latin script decides first,
 * then the most frequent stop words of English, German, Spanish or French. Without a signal it is
 * English.
 */
export function detectResearchLanguage(text: string): string {
  const letters = [...text].filter((char) => /\p{L}/u.test(char));
  const counts = SCRIPT_LANGUAGES.map(
    ([script, language]) => [language, letters.filter((char) => script.test(char)).length] as const,
  ).filter(([, count]) => count > 0);
  const latin = letters.filter((char) => /\p{Script=Latin}/u.test(char)).length;
  const script = counts.sort((a, b) => b[1] - a[1])[0];
  if (script && script[1] >= latin) return script[0];
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const best = Object.entries(STOP_WORDS)
    .map(([language, stop]) => [language, words.filter((word) => stop.has(word)).length] as const)
    .sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : DEFAULT_RESEARCH_LANGUAGE;
}

/** Returns the stored language of a research, or the language guessed from its question. */
export function researchLanguageOf(state: Pick<ResearchState, "question" | "language">): string {
  return state.language ?? detectResearchLanguage(state.question);
}

/** Tells a branch agent to write its findings in the research language, named by its tag. */
export function branchLanguageInstruction(language: string): string {
  return `Write your findings in the language of the research question (${language}). Keep direct quotations and source titles in their original language.`;
}
