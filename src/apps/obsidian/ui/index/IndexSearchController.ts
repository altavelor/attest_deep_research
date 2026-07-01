import { Notice } from "obsidian";

import { IndexingState } from "../../../../adapters/indexing/IndexingService";
import { RetrievedChunk } from "@core/model";
import { toUserMessage } from "../../../../core/errors";
import { IndexProfileSelectOption } from "../chat/ChatComposer";
import { IxplorerPanel } from "../chat/ChatHeader";
import { IndexControlActions, renderIndexControl } from "./IndexControl";
import {
  IndexSearchPanelRefs,
  renderIndexSearchPanel,
  renderIndexSearchResults,
} from "./IndexSearchPanel";
import {
  normalizeExtensionFilter,
  readOptionalNumber,
  readPositiveInteger,
} from "../chat/chatViewHelpers";

export interface IndexSearchOptions {
  profileId: string;
  query: string;
  limit: number;
  minScore?: number;
  extension?: string;
}

/** What the index-search panel needs from its host view. */
export interface IndexSearchControllerContext {
  getIndexProfiles(): IndexProfileSelectOption[];
  getSelectedIndexProfileId(): string;
  getActivePanel(): IxplorerPanel;
  getIndexingState?(indexProfileId?: string): IndexingState | undefined;
  indexingActions?: IndexControlActions;
  searchIndex(options: IndexSearchOptions): Promise<RetrievedChunk[]>;
  onOpenChunk(chunk: RetrievedChunk): void;
}

/**
 * Owns the index-search panel: its query state, results, and the embedded index
 * control. Self-contained — the host view only forwards render/redisplay calls
 * and supplies data through {@link IndexSearchControllerContext}.
 */
export class IndexSearchController {
  private results: RetrievedChunk[] = [];
  private error: string | null = null;
  private isSearching = false;
  private rootEl: HTMLElement | null = null;
  private refs: IndexSearchPanelRefs | null = null;
  private resultsEl: HTMLElement | null = null;
  private indexControlEl: HTMLElement | null = null;

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
      isSearching: this.isSearching,
      onSubmit: () => void this.submitSearch(),
      onProfileChange: () => this.renderIndexControl(),
      onOpenResult: (chunk) => this.ctx.onOpenChunk(chunk),
    });
    this.refs = refs;
    this.indexControlEl = refs.indexControlEl;
    this.resultsEl = refs.resultsEl;
    this.renderIndexControl();
  }

  renderIndexControl(): void {
    if (!this.indexControlEl) {
      return;
    }

    if (this.ctx.getActivePanel() !== "indexSearch") {
      this.indexControlEl.empty();
      return;
    }

    renderIndexControl(this.indexControlEl, {
      compact: true,
      profileId: this.refs?.profileEl.value,
      state: this.ctx.getIndexingState?.(this.refs?.profileEl.value),
      actions: this.ctx.indexingActions ?? {
        start: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        rebuild: () => undefined,
      },
    });
  }

  private renderResults(): void {
    if (!this.resultsEl) {
      return;
    }

    renderIndexSearchResults(this.resultsEl, {
      results: this.results,
      error: this.error,
      isSearching: this.isSearching,
      onOpenResult: (chunk) => this.ctx.onOpenChunk(chunk),
    });
  }

  private async submitSearch(): Promise<void> {
    const query = this.refs?.queryEl.value.trim() ?? "";

    if (!query || this.isSearching) {
      return;
    }

    this.isSearching = true;
    this.error = null;
    this.results = [];
    this.setDisabled(true);
    this.renderResults();

    try {
      this.results = await this.ctx.searchIndex({
        profileId: this.refs?.profileEl.value ?? this.ctx.getIndexProfiles()[0]?.id ?? "",
        query,
        limit: readPositiveInteger(this.refs?.topKEl.value, 5),
        minScore: readOptionalNumber(this.refs?.minScoreEl.value),
        extension: normalizeExtensionFilter(this.refs?.extensionEl.value ?? ""),
      });
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
        element.disabled = disabled;
      }
    }
  }
}
