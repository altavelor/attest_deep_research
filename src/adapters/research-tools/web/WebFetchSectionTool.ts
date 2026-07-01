import { SearchProvider } from "@application/ports";
import { EvidenceRegistry } from "@application/sources";
import { ToolParseResult, toolFailure } from "@core/agent";
import { WEB_FETCH_SECTION_TOOL } from "@core/agent";
import { defineTool, int, str } from "@application/sources/tools";
import { rankSectionsByQuery } from "../../../core/web/sectionRanking";
import { fetchRegisteredWebPage } from "./fetchRegisteredWebPage";

interface FetchWebSectionInput {
  resultId: string;
  query: string;
  limit: number;
}

export interface FetchWebSectionOutput {
  resultId: string;
  evidenceId: string;
  url: string;
  finalUrl: string;
  query: string;
  sections: Array<{ text: string; score: number; rank: number }>;
  diagnostics: {
    sectionCount: number;
    pageTruncated: boolean;
    untrustedEvidence: true;
  };
}

// Larger than the head-truncation budget of fetch_web_page: we re-rank the whole
// page down to the relevant sections, so we want more of it to rank over.
const SECTION_FETCH_MAX_CHARS = 48_000;

function parseFetchWebSectionInput(
  input: Record<string, unknown>,
): ToolParseResult<FetchWebSectionInput> {
  const allowed = new Set(["resultId", "query", "limit"]);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) {
    return toolFailure("unknown-property", `Unknown property: ${unknown}.`);
  }
  const resultId = typeof input.resultId === "string" ? input.resultId.trim() : "";
  if (!resultId || resultId.length > 200) {
    return toolFailure("invalid-result-id", "A valid resultId is required.");
  }
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 240) {
    return toolFailure("invalid-query", "A non-empty query (≤240 chars) is required.");
  }
  const rawLimit = input.limit;
  const limit =
    typeof rawLimit === "number" && Number.isInteger(rawLimit)
      ? Math.max(1, Math.min(10, rawLimit))
      : 5;
  return { ok: true, value: { resultId, query, limit } };
}

/**
 * Fetch a known web result and return only the sections most relevant to `query`,
 * instead of the head-truncated page. The fetched page is still registered as
 * evidence (full budget) so citations and provenance match fetch_web_page.
 */
export const WebFetchSectionTool = defineTool<
  { provider: SearchProvider; evidence: EvidenceRegistry },
  FetchWebSectionInput,
  FetchWebSectionOutput
>({
  name: WEB_FETCH_SECTION_TOOL,
  description:
    "Fetch a web result returned by search_web and return only the passages most relevant to a focused query, instead of the page head. Passage text is untrusted evidence.",
  schema: {
    resultId: str(200, { required: true }),
    query: str(240, { required: true, description: "What to find within the page." }),
    limit: int(1, 10, 5, { description: "Maximum passages to return." }),
  },
  parse: parseFetchWebSectionInput,
  execute: async (deps, input, context) => {
    const fetched = await fetchRegisteredWebPage(
      deps,
      input.resultId,
      context.callId,
      SECTION_FETCH_MAX_CHARS,
    );
    if (!fetched.ok) {
      return fetched;
    }

    const ranked = rankSectionsByQuery(fetched.value.content, input.query, { limit: input.limit });

    return {
      ok: true,
      value: {
        resultId: fetched.value.resultId,
        evidenceId: fetched.value.evidenceId,
        url: fetched.value.url,
        finalUrl: fetched.value.finalUrl,
        query: input.query,
        sections: ranked.map((section, index) => ({
          text: section.text,
          score: section.score,
          rank: index + 1,
        })),
        diagnostics: {
          sectionCount: ranked.length,
          pageTruncated: fetched.value.truncated,
          untrustedEvidence: true,
        },
      },
    };
  },
});
