import type { ResearchSearchMode } from "@application/use-cases/research";
import { requiresIndexRebuildForImages } from "@adapters/indexing";

export function searchUnavailableMessage(input: {
  chatModelProfileId: string;
  indexProfileId?: string;
  searchMode: ResearchSearchMode;
  isWebSearchEnabled: boolean;
}): string | null {
  if (!input.chatModelProfileId) {
    return "Create and select a chat model profile in Ixplorer settings.";
  }
  if (input.searchMode !== "webOnly" && input.searchMode !== "none" && !input.indexProfileId) {
    return "Create and select an active index in Ixplorer settings.";
  }
  if (
    input.searchMode !== "indexOnly" &&
    input.searchMode !== "none" &&
    !input.isWebSearchEnabled
  ) {
    return "Enable web search in Ixplorer settings to use this search mode.";
  }
  return null;
}

/**
 * Non-blocking notice for an index built before document-image metadata
 * existed. Text retrieval is unaffected, so this never blocks a question; it
 * yields null for an up-to-date profile or when no index is selected.
 */
export function legacyIndexImageNotice(profile?: { indexVersion?: number }): string | null {
  if (!profile || !requiresIndexRebuildForImages(profile)) return null;
  return "Text search works with this index, but image discovery from your documents needs a full rebuild.";
}

export interface ContextWindowStatus {
  usedPercent: number;
  isWarning: boolean;
  title: string;
  ariaLabel: string;
}

export function contextWindowStatus(
  estimatedTokens: number,
  limitTokens: number,
): ContextWindowStatus {
  const usedPercent = Math.max(0, Math.min(100, Math.round((estimatedTokens / limitTokens) * 100)));
  const leftPercent = Math.max(0, 100 - usedPercent);
  const isWarning = usedPercent >= 80;
  return {
    usedPercent,
    isWarning,
    title: [
      isWarning ? "Context window warning:" : "Context window:",
      `${usedPercent}% used (${leftPercent}% left)`,
      `Estimated ${estimatedTokens} of ${limitTokens} tokens`,
      ...(isWarning ? ["Long history may reduce retrieved evidence budget."] : []),
    ].join("\n"),
    ariaLabel: `${isWarning ? "Context window warning" : "Context window"}: ${usedPercent}% used, ${leftPercent}% left`,
  };
}
