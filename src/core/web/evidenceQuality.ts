const TRACKING_QUERY_KEYS = new Set(["fbclid", "gclid", "yclid"]);
const AMP_QUERY_KEYS = new Set(["amp", "amp_js_v", "amp_gsa"]);

export interface WebTextQualityAssessment {
  readable: boolean;
  replacementCharacterRatio: number;
  nonWordCharacterRatio: number;
}

export function canonicalizeWebEvidenceUrl(value: string): string {
  const fallback = value.trim();
  try {
    const url = new URL(fallback);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^(?:www|m|amp)\./, "");

    let pathname = url.pathname;
    pathname = pathname
      .replace(/(.+)\/amp(?:\.html?)?\/?$/i, "$1")
      .replace(/\.amp(?:\.html?)?\/?$/i, "");
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
    url.pathname = pathname || "/";

    for (const key of Array.from(url.searchParams.keys())) {
      const normalizedKey = key.toLowerCase();
      const value = url.searchParams.get(key)?.toLowerCase() ?? "";
      if (
        TRACKING_QUERY_KEYS.has(normalizedKey) ||
        normalizedKey.startsWith("utm_") ||
        AMP_QUERY_KEYS.has(normalizedKey) ||
        (normalizedKey === "output" && value === "amp")
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();

    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return fallback;
  }
}

export function assessWebTextQuality(text: string): WebTextQualityAssessment {
  const characters = [...text];
  if (characters.length === 0 || text.trim().length === 0) {
    return { readable: false, replacementCharacterRatio: 0, nonWordCharacterRatio: 0 };
  }

  const replacementCharacters = characters.filter((character) => character === "\uFFFD").length;
  const nonWordCharacters = characters.filter(
    (character) => !/[\p{L}\p{N}\p{M}\s]/u.test(character),
  ).length;
  const replacementCharacterRatio = replacementCharacters / characters.length;
  const nonWordCharacterRatio = nonWordCharacters / characters.length;
  const wordCharacterRatio =
    characters.filter((character) => /[\p{L}\p{N}\p{M}]/u.test(character)).length /
    characters.length;
  const replacementCorruption = replacementCharacters >= 2 && replacementCharacterRatio >= 0.02;
  const symbolCorruption =
    characters.length >= 20 && nonWordCharacterRatio >= 0.6 && wordCharacterRatio < 0.1;

  return {
    readable: !replacementCorruption && !symbolCorruption,
    replacementCharacterRatio,
    nonWordCharacterRatio,
  };
}
