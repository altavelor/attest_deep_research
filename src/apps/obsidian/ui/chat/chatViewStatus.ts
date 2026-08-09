import type { ResearchSearchMode } from "@application/use-cases/research";
import { requiresIndexRebuildForImages } from "@adapters/indexing";
import type { Translate } from "@adapters/i18n";

export function searchUnavailableMessage(
  input: {
    chatModelProfileId: string;
    indexProfileId?: string;
    searchMode: ResearchSearchMode;
    isWebSearchEnabled: boolean;
  },
  t: Translate,
): string | null {
  if (!input.chatModelProfileId) {
    return t("chat.status.noChatModel");
  }
  if (input.searchMode !== "webOnly" && input.searchMode !== "none" && !input.indexProfileId) {
    return t("chat.status.noIndex");
  }
  if (
    input.searchMode !== "indexOnly" &&
    input.searchMode !== "none" &&
    !input.isWebSearchEnabled
  ) {
    return t("chat.status.webSearchDisabled");
  }
  return null;
}

/**
 * Non-blocking notice for an index built before document-image metadata
 * existed. Text retrieval is unaffected, so this never blocks a question; it
 * yields null for an up-to-date profile or when no index is selected.
 */
export function legacyIndexImageNotice(
  profile: { indexVersion?: number } | undefined,
  t: Translate,
): string | null {
  if (!profile || !requiresIndexRebuildForImages(profile)) return null;
  return t("chat.status.legacyIndexImages");
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
  t: Translate,
): ContextWindowStatus {
  const usedPercent = Math.max(0, Math.min(100, Math.round((estimatedTokens / limitTokens) * 100)));
  const leftPercent = Math.max(0, 100 - usedPercent);
  const isWarning = usedPercent >= 80;
  return {
    usedPercent,
    isWarning,
    title: [
      isWarning
        ? t("chat.status.contextWindow.warningTitle")
        : t("chat.status.contextWindow.title"),
      t("chat.status.contextWindow.usage", { used: usedPercent, left: leftPercent }),
      t("chat.status.contextWindow.estimate", {
        estimated: estimatedTokens,
        limit: limitTokens,
      }),
      ...(isWarning ? [t("chat.status.contextWindow.warningHint")] : []),
    ].join("\n"),
    ariaLabel: isWarning
      ? t("chat.status.contextWindow.warningAria", { used: usedPercent, left: leftPercent })
      : t("chat.status.contextWindow.aria", { used: usedPercent, left: leftPercent }),
  };
}
