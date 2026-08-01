import { Notice } from "obsidian";

import { RetrievedChunk } from "@core/model";
import { toUserMessage } from "@core/errors";
import { IndexProfileSelectOption } from "@apps/obsidian/ui/chat/ChatComposer";
import {
  IndexSearchPanelRefs,
  renderIndexSearchPanel,
  renderIndexSearchResults,
} from "./IndexSearchPanel";
import {
  normalizeExtensionFilter,
  readOptionalNumber,
  readPositiveInteger,
} from "@apps/obsidian/ui/chat/chatViewHelpers";

export interface IndexSearchOptions {
  profileId: string;
  query: string;
  limit: number;
  minScore?: number;
  extension?: string;
}

export interface IndexSearchResult {
  chunks: RetrievedChunk[];
  semanticError?: string;
}

/** What the index-search panel needs from its host view. */
export interface IndexSearchControllerContext {
  getIndexProfiles(): IndexProfileSelectOption[];
  getSelectedIndexProfileId(): string;
  getEmbedderWarning(indexProfileId: string): string | undefined;
  searchIndex(options: IndexSearchOptions): Promise<IndexSearchResult>;
  onOpenChunk(chunk: RetrievedChunk): void;
}

/**
 * Owns the index-search panel query state and results.
 */
export class IndexSearchController {
  private results: RetrievedChunk[] = [];
  private error: string | null = null;
  private semanticError: string | null = null;
  private isSearching = false;
  private rootEl: HTMLElement | null = null;
  private refs: IndexSearchPanelRefs | null = null;
  private resultsEl: HTMLElement | null = null;

  constructor(private readonly ctx: IndexSearchControllerContext) {}

  render(rootEl: HTMLElement): void {
    this.rootEl = rootEl;
    this.renderPanel();
  }

  private renderPanel(): void {
    if (!this.rootEl) {
      return;
    }

    const refs = renderIndexSearchPanel(this.rootEl, {
      profiles: this.ctx.getIndexProfiles(),
      selectedProfileId: this.ctx.getSelectedIndexProfileId(),
      results: this.results,
      error: this.error,
      warning: this.warning(),
      isSearchBlocked: this.isSearchBlocked(),
      isSearching: this.isSearching,
      onSubmit: () => void this.submitSearch(),
      onProfileChange: () => this.updateSearchAvailability(),
      onOpenResult: (chunk) => this.ctx.onOpenChunk(chunk),
    });
    this.refs = refs;
    this.resultsEl = refs.resultsEl;
  }

  private renderResults(): void {
    if (!this.resultsEl) {
      return;
    }

    renderIndexSearchResults(this.resultsEl, {
      results: this.results,
      error: this.error,
      warning: this.warning(),
      isSearching: this.isSearching,
      onOpenResult: (chunk) => this.ctx.onOpenChunk(chunk),
    });
  }

  private async submitSearch(): Promise<void> {
    const query = this.refs?.queryEl.value.trim() ?? "";

    if (!query || this.isSearching || this.isSearchBlocked()) {
      return;
    }

    this.isSearching = true;
    this.error = null;
    this.semanticError = null;
    this.results = [];
    this.setDisabled(true);
    this.renderResults();

    try {
      const result = await this.ctx.searchIndex({
        profileId: this.refs?.profileEl.value ?? this.ctx.getIndexProfiles()[0]?.id ?? "",
        query,
        limit: readPositiveInteger(this.refs?.topKEl.value, 5),
        minScore: readOptionalNumber(this.refs?.minScoreEl.value),
        extension: normalizeExtensionFilter(this.refs?.extensionEl.value ?? ""),
      });
      this.results = result.chunks;
      this.semanticError = result.semanticError ?? null;
    } catch (error) {
      this.error = toUserMessage(error);
      new Notice(toUserMessage(error));
    } finally {
      this.isSearching = false;
      this.setDisabled(false);
      this.renderResults();
    }
  }

  private setDisabled(disabled: boolean): void {
    for (const element of [
      this.refs?.profileEl,
      this.refs?.queryEl,
      this.refs?.topKEl,
      this.refs?.minScoreEl,
      this.refs?.extensionEl,
      this.refs?.buttonEl,
    ]) {
      if (element) {
        element.disabled = disabled || (element === this.refs?.buttonEl && this.isSearchBlocked());
      }
    }
  }

  private updateSearchAvailability(): void {
    this.setDisabled(this.isSearching);
    this.renderResults();
  }

  private isSearchBlocked(): boolean {
    return Boolean(this.ctx.getEmbedderWarning(this.selectedProfileId()));
  }

  private warning(): string | null {
    const preflightWarning = this.ctx.getEmbedderWarning(this.selectedProfileId());
    if (preflightWarning) {
      return preflightWarning;
    }
    return this.semanticError
      ? "Index search degraded to keyword-only ranking because embedding retrieval is unavailable."
      : null;
  }

  private selectedProfileId(): string {
    if (this.refs?.profileEl.value) {
      return this.refs.profileEl.value;
    }

    const profiles = this.ctx.getIndexProfiles();
    const configuredProfile = profiles.find(
      (profile) =>
        profile.id === this.ctx.getSelectedIndexProfileId() &&
        !profile.isSuspended &&
        profile.isIndexed === true,
    );
    return (
      configuredProfile?.id ??
      profiles.find((profile) => !profile.isSuspended && profile.isIndexed === true)?.id ??
      ""
    );
  }
}
