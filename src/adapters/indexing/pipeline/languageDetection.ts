import { francAll } from "franc-min";

import { LanguageCode, LanguageInventoryItem } from "../../../core/model/citation";
import { normalizeInlineWhitespace } from "../../../shared/whitespace";

const UNKNOWN_LANGUAGE = "unknown";
const MIN_SAMPLE_LENGTH = 120;
const MAX_SAMPLE_LENGTH = 8_000;
const ISO_639_3_TO_1: Record<string, string> = {
  eng: "en",
  rus: "ru",
  deu: "de",
  fra: "fr",
  spa: "es",
  ita: "it",
  por: "pt",
  nld: "nl",
  pol: "pl",
  ukr: "uk",
};

export function detectTextLanguages(text: string): LanguageCode[] {
  const sample = normalizeInlineWhitespace(text).slice(0, MAX_SAMPLE_LENGTH);

  if (sample.length === 0) {
    return [UNKNOWN_LANGUAGE];
  }

  const scriptLanguage = detectDominantScriptLanguage(sample);
  if (scriptLanguage) {
    return [scriptLanguage];
  }

  if (sample.length < MIN_SAMPLE_LENGTH) {
    return isLatinDominant(sample) ? ["en"] : [UNKNOWN_LANGUAGE];
  }

  const detected = francAll(sample, {
    minLength: MIN_SAMPLE_LENGTH,
    only: Object.keys(ISO_639_3_TO_1),
  })
    .slice(0, 1)
    .map(([language]) => ISO_639_3_TO_1[language])
    .filter((language): language is string => typeof language === "string");

  return uniqueLanguages(detected);
}

export function languageInventoryFromSources(
  sources: Array<{ languages?: string[]; chunkCount: number; failed?: boolean }>,
): LanguageInventoryItem[] {
  const byLanguage = new Map<string, { chunkCount: number; sourceCount: number }>();

  for (const source of sources) {
    if (source.failed === true) {
      continue;
    }

    const languages = uniqueLanguages(source.languages ?? [UNKNOWN_LANGUAGE]);

    for (const language of languages) {
      const existing = byLanguage.get(language) ?? { chunkCount: 0, sourceCount: 0 };
      byLanguage.set(language, {
        chunkCount: existing.chunkCount + source.chunkCount,
        sourceCount: existing.sourceCount + 1,
      });
    }
  }

  return Array.from(byLanguage.entries())
    .map(([language, counts]) => ({ language, ...counts }))
    .sort(
      (left, right) =>
        right.chunkCount - left.chunkCount || left.language.localeCompare(right.language),
    );
}

function detectDominantScriptLanguage(text: string): LanguageCode | null {
  const cyrillic = countMatches(text, /\p{Script=Cyrillic}/gu);
  const latin = countMatches(text, /\p{Script=Latin}/gu);
  const total = cyrillic + latin;

  if (total < 20) {
    return null;
  }

  if (cyrillic / total >= 0.65) {
    return "ru";
  }

  return null;
}

function isLatinDominant(text: string): boolean {
  const cyrillic = countMatches(text, /\p{Script=Cyrillic}/gu);
  const latin = countMatches(text, /\p{Script=Latin}/gu);
  const total = cyrillic + latin;

  return total >= 20 && latin / total >= 0.9;
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length;
}

function uniqueLanguages(languages: string[]): string[] {
  const normalized = languages.map((language) => language.trim().toLowerCase()).filter(Boolean);

  return Array.from(new Set(normalized.length > 0 ? normalized : [UNKNOWN_LANGUAGE]));
}
