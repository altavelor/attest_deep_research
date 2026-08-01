/** Builds the hard availability boundary for the evidence sources exposed to a profile. */
export function buildSourceAvailabilityRule(hasWeb: boolean, hasIndex: boolean): string {
  const active: string[] = [];
  if (hasIndex) active.push("the local index (search_index)");
  if (hasWeb) active.push("web search (search_web, fetch_web_page)");

  const lines: string[] = ["## Source availability (hard limit)"];
  lines.push(
    active.length > 0
      ? `Active evidence sources in this profile: ${active.join(" and ")}.`
      : "This profile exposes no evidence sources: you cannot search the web or the local index.",
  );
  if (!hasWeb) {
    lines.push(
      "Web is OFF: you have no search_web / fetch_web_page tools. You cannot open URLs, browse, or search the internet.",
    );
  }
  if (!hasIndex) {
    lines.push(
      "Local index is OFF: you have no search_index tool. You cannot search the indexed vault/library.",
    );
  }
  lines.push(
    "If the user explicitly requires a source that is OFF (e.g. asks you to open a URL or " +
      "search the web while web is OFF, or to search the local index while it is OFF), do NOT " +
      "silently fall back to another source and do NOT answer from memory. Reply that this " +
      'requires switching the search mode (in the composer: "Index", "Web", or "Index + Web") ' +
      "to the one that provides the needed source, name that mode, and stop without calling tools.",
  );
  return lines.join("\n");
}

/** Builds index-specific tool guidance around the selected index description. */
export function buildIndexSkill(indexDescription: string): string {
  return `## Using the Local Index (search_index)

### Current index
<index-description>
${indexDescription}
</index-description>

Use search_index to find content from this index that is relevant to the question.
Use list_index_urls when the user asks for an exhaustive URL/link inventory from the
indexed material. Use check_urls to verify HTTP(S) URL reachability in batches.

### Strategy
- Formulate queries as concise phrases (≤240 chars) that capture the intent of the question.
- Run independent sub-queries in parallel if the question has multiple distinct facets.
- Use the returned \`evidenceId\` to cite results in your answer.
- If results are insufficient, rephrase the query — do not call search_index with the same query twice.
- If a top result looks like a heading, a title, or a fragment of a longer passage, call
  \`read_index_section\` with its \`chunkId\` to read the whole section in one call — do not
  reassemble it chunk-by-chunk with read_index_chunk. Continue with \`cursor\` if truncated.
- For broad or comparative questions ("what does the corpus say about…", "compare the
  documents on…"), start from the document list in <index-description> and
  \`get_source_summary\` to pick relevant documents and sections, then go deep with
  search_index or read_index_section scoped by \`sourcePath\`.
- \`limit\` controls how many results to return (max 5). Start with 3–5; increase only if needed.
- For URL audits, page through \`list_index_urls\` with \`cursor\` until no \`nextCursor\`
  remains. Its \`limit\` is capped at 100. Preserve each URL's \`purpose\`, \`context\`,
  and source metadata when writing a markdown report.
- For reachability checks, pass URLs from \`list_index_urls\` to \`check_urls\` in batches
  of up to 100 and record state/status/finalUrl/error without inventing missing data.
  Treat \`state: "unknown"\` as inconclusive, not as a dead link.

### Reading results
Each result has:
- \`evidenceId\` — use this in [square brackets] to cite the source
- \`snippet\` — a preview of the content (may be truncated)
- \`score\` — semantic relevance (higher = more relevant)
- \`path\` — vault path of the source note (for reference only, not for use as evidenceId)`;
}
