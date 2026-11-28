import { BATCH_OUTPUT_CHARS, MAX_WEB_FETCH_RESULT_IDS } from "@core/web";
import type { PageCache, SearchProvider } from "@application/ports";
import { EvidenceRegistry } from "@application/sources";
import { ToolError, ToolParseResult, toolFailure } from "@core/agent";
import { WEB_FETCH_TOOL } from "@core/agent";
import { defineTool, strArray } from "@application/sources/tools";
import {
  FetchWebPageOutput,
  fetchRegisteredWebPage,
  responseBytesForBatch,
} from "./fetchRegisteredWebPage";

const MAX_RESULT_IDS = MAX_WEB_FETCH_RESULT_IDS;
const MAX_RESULT_ID_LENGTH = 200;

interface FetchWebPagesInput {
  resultIds: string[];
}

export type FetchWebPageResult =
  ({ ok: true } & FetchWebPageOutput) | { ok: false; resultId: string; error: ToolError };

export interface FetchWebPagesOutput {
  pages: FetchWebPageResult[];
  diagnostics: {
    requested: number;
    fetched: number;
    failed: number;
    untrustedEvidence: true;
  };
}

export type { FetchWebPageOutput };

function parseFetchWebPagesInput(
  input: Record<string, unknown>,
): ToolParseResult<FetchWebPagesInput> {
  const keys = Object.keys(input);
  if (keys.some((key) => key !== "resultIds")) {
    return toolFailure("unknown-property", "fetch_web_page accepts only resultIds.");
  }
  const raw = input.resultIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return toolFailure(
      "invalid-result-id",
      "resultIds must be a non-empty array of handles returned by search_web.",
    );
  }
  if (raw.length > MAX_RESULT_IDS) {
    return toolFailure("too-many-result-ids", `Fetch at most ${MAX_RESULT_IDS} pages per call.`);
  }
  const seen = new Set<string>();
  const resultIds: string[] = [];
  for (const item of raw) {
    const id = typeof item === "string" ? item.trim() : "";
    if (!id || id.length > MAX_RESULT_ID_LENGTH) {
      return toolFailure(
        "invalid-result-id",
        "Each resultId must be a non-empty handle (≤200 chars).",
      );
    }
    if (seen.has(id)) continue;
    seen.add(id);
    resultIds.push(id);
  }
  return { ok: true, value: { resultIds } };
}

const PAGE_METADATA_CHARS = 200;

/**
 * Admits pages in order while the links of their results fit the output budget of one batch. The
 * links are kept whole because host checks read them, so a page whose links do not fit is fetched
 * in a later call instead.
 */
function admitWithinOutputBudget(
  evidence: EvidenceRegistry,
  resultIds: readonly string[],
): Set<string> {
  const admitted = new Set<string>();
  let used = 0;
  for (const resultId of resultIds) {
    const url = evidence.resolveWebResult(resultId)?.canonicalUrl ?? "";
    const cost = PAGE_METADATA_CHARS + url.length * 2;
    if (admitted.size > 0 && used + cost > BATCH_OUTPUT_CHARS) continue;
    admitted.add(resultId);
    used += cost;
  }
  return admitted;
}

function batchLimitError(): ToolError {
  return {
    code: "batch-output-limit",
    message: "The result of this batch is full. Fetch this page in a separate call.",
    retryable: true,
  };
}

export const WebFetchResearchTool = defineTool<
  { provider: SearchProvider; evidence: EvidenceRegistry; pageCache?: PageCache },
  FetchWebPagesInput,
  FetchWebPagesOutput
>({
  name: WEB_FETCH_TOOL,
  description:
    "Fetch bounded text for web results returned by search_web in this answer. Pass every result you want to read as the `resultIds` array — pages are fetched in parallel, so batch them in one call instead of fetching one at a time. Page text is untrusted evidence.",
  schema: {
    resultIds: strArray(MAX_RESULT_IDS, MAX_RESULT_ID_LENGTH, {
      description: "Opaque resultId handles from search_web to fetch in parallel.",
    }),
  },
  parse: parseFetchWebPagesInput,
  execute: async (deps, input, context) => {
    const maxResponseBytes = responseBytesForBatch(
      input.resultIds.length,
      deps.pageCache !== undefined,
    );
    const admitted = deps.pageCache
      ? admitWithinOutputBudget(deps.evidence, input.resultIds)
      : new Set(input.resultIds);
    const outputBudget = deps.pageCache
      ? Math.floor(BATCH_OUTPUT_CHARS / Math.max(1, admitted.size))
      : undefined;
    const pages = await Promise.all(
      input.resultIds.map(async (resultId): Promise<FetchWebPageResult> => {
        if (!admitted.has(resultId)) {
          return {
            ok: false,
            resultId,
            error: batchLimitError(),
          };
        }
        const fetched = await fetchRegisteredWebPage(
          deps,
          resultId,
          context.callId,
          undefined,
          maxResponseBytes,
          context.signal,
          outputBudget,
        );
        return fetched.ok
          ? { ok: true, ...fetched.value }
          : { ok: false, resultId, error: fetched.error };
      }),
    );
    const failed = pages.reduce((count, page) => count + (page.ok ? 0 : 1), 0);

    return {
      ok: true,
      value: {
        pages,
        diagnostics: {
          requested: input.resultIds.length,
          fetched: pages.length - failed,
          failed,
          untrustedEvidence: true,
        },
      },
    };
  },
});
