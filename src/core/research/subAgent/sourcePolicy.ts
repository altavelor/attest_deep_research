import type { ResearchSearchMode } from "../searchMode";
import { subAgentSessionError, type SubAgentSessionError } from "./errors";
import type { SubAgentScopeReduction, SubAgentSourcePolicy } from "./sessionModel";

export type SubAgentSourcePolicyReduction =
  { ok: true; policy: SubAgentSourcePolicy } | { ok: false; error: SubAgentSessionError };

const NARROWER_SEARCH_MODES: Readonly<Record<ResearchSearchMode, readonly ResearchSearchMode[]>> = {
  indexAndWeb: ["indexAndWeb", "indexOnly", "webOnly", "none"],
  indexOnly: ["indexOnly", "none"],
  webOnly: ["webOnly", "none"],
  none: ["none"],
};

/**
 * Narrows a maximum source policy by an optional reduction and never widens it.
 * Search mode may only drop sources, paths must be canonical and covered by the
 * maximum grant, and the active file can only be withdrawn.
 */
export function reduceSubAgentSourcePolicy(
  maximum: SubAgentSourcePolicy,
  reduction?: SubAgentScopeReduction,
): SubAgentSourcePolicyReduction {
  if (!reduction) return { ok: true, policy: maximum };
  const searchMode = reduction.searchMode ?? maximum.searchMode;
  const paths = canonicalizePaths(reduction.contextPaths);
  if (
    !NARROWER_SEARCH_MODES[maximum.searchMode].includes(searchMode) ||
    (reduction.allowActiveFile as unknown) !== false ||
    paths === null ||
    !paths.every((path) => pathGranted(maximum, path))
  ) {
    return { ok: false, error: subAgentSessionError("source-scope-denied") };
  }
  return {
    ok: true,
    policy: {
      searchMode,
      contextPaths: paths,
      indexScope: paths.length > 0 ? "paths" : "none",
      allowActiveFile: false,
      allowNoteMutation: false,
    },
  };
}

function pathGranted(maximum: SubAgentSourcePolicy, path: string): boolean {
  if (maximum.indexScope === "all-allowed") return true;
  return maximum.contextPaths.some((granted) => path === granted || path.startsWith(`${granted}/`));
}

function canonicalizePaths(paths: readonly string[]): string[] | null {
  const canonical: string[] = [];
  for (const path of paths) {
    const segments = path
      .replace(/\\/g, "/")
      .split("/")
      .filter((segment) => segment !== "" && segment !== ".");
    if (segments.length === 0 || segments.includes("..")) return null;
    const joined = segments.join("/");
    if (!canonical.includes(joined)) canonical.push(joined);
  }
  return canonical;
}
