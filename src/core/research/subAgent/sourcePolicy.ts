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

/**
 * Intersects two source policies so a continued session never exceeds either the policy
 * it was created with or the grant of the parent run that continues it. Search modes,
 * paths and the active file are each narrowed to what both allow.
 */
export function intersectSubAgentSourcePolicy(
  left: SubAgentSourcePolicy,
  right: SubAgentSourcePolicy,
): SubAgentSourcePolicy {
  const searchMode = NARROWER_SEARCH_MODES[right.searchMode].includes(left.searchMode)
    ? left.searchMode
    : NARROWER_SEARCH_MODES[left.searchMode].includes(right.searchMode)
      ? right.searchMode
      : "none";
  const scope = intersectScope(left, right);
  return {
    searchMode,
    ...scope,
    allowActiveFile: left.allowActiveFile && right.allowActiveFile,
    allowNoteMutation: false,
  };
}

function intersectScope(
  left: SubAgentSourcePolicy,
  right: SubAgentSourcePolicy,
): Pick<SubAgentSourcePolicy, "contextPaths" | "indexScope"> {
  if (left.indexScope === "all-allowed") return pick(right);
  if (right.indexScope === "all-allowed") return pick(left);
  const paths = [
    ...left.contextPaths.filter((path) => pathGranted(right, path)),
    ...right.contextPaths.filter((path) => pathGranted(left, path)),
  ].filter((path, index, all) => all.indexOf(path) === index);
  return { contextPaths: paths, indexScope: paths.length > 0 ? "paths" : "none" };
}

function pick(
  policy: SubAgentSourcePolicy,
): Pick<SubAgentSourcePolicy, "contextPaths" | "indexScope"> {
  return { contextPaths: policy.contextPaths, indexScope: policy.indexScope };
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
