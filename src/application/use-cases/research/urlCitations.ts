// Rewrite the model's inline web-citation handles into human-clickable links.
//
// Models cite web sources by the handle `[url:https://…]` (see thinkingPrompts).
// That token is meant for citation *resolution*, not for a
// reader — left verbatim in a saved note it renders as inert `[url:…]` text. This
// turns any still-unresolved URL handle into a plain markdown link so it opens in
// the browser. Malformed or non-public URLs are left untouched (not a link we honor).

import { validatePublicWebUrl } from "@application/sources/WebUrlPolicy";

const URL_CITATION = /\[url:([^\]\n]+)\]/g;

export function linkifyUrlCitations(text: string): string {
  return text.replace(URL_CITATION, (match, raw: string) => {
    const validated = validatePublicWebUrl(raw.trim());
    return validated.ok ? `[${validated.url}](${validated.url})` : match;
  });
}
