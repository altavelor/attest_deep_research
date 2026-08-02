// Rewrite the model's inline web-citation handles into human-clickable links.
//
// Models cite web sources by the handle `[url:https://…]` (see thinkingPrompts).
// That token is meant for citation *resolution*, not for a
// reader — left verbatim it renders as inert `[url:…]` text. This turns any
// still-unresolved URL handle into a plain markdown link so it opens in the
// browser. Malformed or non-public URLs are left untouched (not a link we honor).

import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";

const URL_CITATION = /\[url:([^\]\n]+)\]/g;
const MAX_LABEL_LENGTH = 60;

export interface LinkifyUrlCitationsOptions {
  /** Builds the visible link text; defaults to the full URL. */
  label?(url: string): string;
}

export function linkifyUrlCitations(
  text: string,
  options: LinkifyUrlCitationsOptions = {},
): string {
  return text.replace(URL_CITATION, (match, raw: string) => {
    const validated = validatePublicWebUrl(raw.trim());
    if (!validated.ok) return match;
    const label = options.label?.(validated.url) ?? validated.url;
    return `[${escapeLinkLabel(label)}](${validated.url})`;
  });
}

/**
 * Compact, readable link text for a web citation: the decoded last path segment
 * when the URL has one (`…/wiki/Солнечная_система` → "Солнечная система"),
 * otherwise the host. Keeps a chat answer readable where the raw percent-encoded
 * URL would take several lines.
 */
export function shortUrlCitationLabel(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const host = parsed.hostname.replace(/^www\./i, "");
  const segment = parsed.pathname.split("/").filter(Boolean).at(-1);
  const title = segment ? decodeSegment(segment) : "";
  return title ? `${clamp(title)} — ${host}` : host;
}

/** Decodes a path segment into a title, falling back to it on bad encoding. */
function decodeSegment(segment: string): string {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }
  return decoded
    .replace(/\.(html?|php|aspx?|jsp)$/i, "")
    .replace(/[_+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: string): string {
  return value.length > MAX_LABEL_LENGTH ? `${value.slice(0, MAX_LABEL_LENGTH - 1)}…` : value;
}

/** Escapes brackets, which would otherwise terminate the markdown link early. */
function escapeLinkLabel(value: string): string {
  return value.replace(/([[\]])/g, "\\$1");
}
