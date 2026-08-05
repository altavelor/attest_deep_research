import type IxplorerPlugin from "@apps/obsidian/main";
import { IndexProfile, formatIndexSize } from "@adapters/indexing";
import { MAX_INDEX_PROFILE_COUNT, getActiveIndexProfile } from "@adapters/settings";
import { App, Notice, Setting } from "obsidian";
import { IndexProfileModal } from "./IndexProfileModal";
import { IndexReportModal } from "./IndexReportModal";
import { IndexRunModal } from "./IndexRunModal";
import { resolveIndexProfileColumnStatus, resolveIndexStatusBadge } from "./indexProfileStatus";
import type { EnrichmentPendingAction, IndexPendingAction } from "./indexProfileStatus";
import { createIconButton, formatEnrichmentStatus } from "./shared";

export class IndexProfilesSection {
  private unsubscribeIndexing: (() => void) | null = null;
  private unsubscribeEnrichment: (() => void) | null = null;
  private readonly pendingIndexActions = new Map<string, IndexPendingAction>();
  private readonly pendingEnrichmentActions = new Map<string, EnrichmentPendingAction>();

  constructor(
    private readonly app: App,
    private readonly plugin: IxplorerPlugin,
    private readonly requestRedisplay: () => void,
  ) {}

  dispose(): void {
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    this.unsubscribeEnrichment?.();
    this.unsubscribeEnrichment = null;
  }

  render(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Indexing").setHeading();
    const section = containerEl.createDiv({ cls: "ixplorer-settings-profile-section" });
    const header = section.createDiv({ cls: "ixplorer-settings-profile-section__header" });
    header.createEl("h3", { text: "Index profiles" });
    createIconButton(header, {
      icon: "plus",
      label: "Add index profile",
      disabled: this.plugin.settings.indexProfiles.length >= MAX_INDEX_PROFILE_COUNT,
      onClick: () => this.openAddModal(),
    });
    const table = section.createDiv({
      cls: "ixplorer-settings-profile-table ixplorer-settings-index-table",
    });
    const tableHeader = table.createDiv({
      cls: "ixplorer-settings-profile-table__header ixplorer-settings-index-table__header",
      attr: { role: "row" },
    });
    for (const title of ["Index", "Size", "Status", "Actions"])
      tableHeader.createSpan({ text: title });
    const rows = table.createDiv({ cls: "ixplorer-settings-profile-list" });
    const renderRows = () => {
      rows.empty();
      this.renderRows(rows);
    };
    renderRows();
    this.unsubscribeIndexing = this.plugin.indexing.subscribeAll(renderRows);
    this.unsubscribeEnrichment = this.plugin.enrichment.subscribeAll(renderRows);
  }

  private renderRows(containerEl: HTMLElement): void {
    const busy = this.plugin.indexing.getBusyProfileId();
    for (const profile of this.plugin.settings.indexProfiles) {
      const indexing = this.plugin.indexing.getState(profile.id);
      const enrichment = this.plugin.enrichment.getState(profile.id);
      this.syncPending(profile.id, indexing.status, indexing.activeOperation, enrichment.status);
      const pendingIndexAction = this.pendingIndexActions.get(profile.id);
      const pendingEnrichmentAction = this.pendingEnrichmentActions.get(profile.id);
      const row = containerEl.createDiv({
        cls: "ixplorer-settings-profile-list__item ixplorer-settings-index-list__item",
      });
      const name = row.createDiv({ cls: "ixplorer-settings-profile-list__name" });
      name.createDiv({ cls: "ixplorer-settings-index-list__title", text: profile.name });
      const columnStatus = resolveIndexProfileColumnStatus({
        indexing,
        enrichment,
        pendingIndexAction,
        pendingEnrichmentAction,
      });
      const paths =
        profile.mode === "wholeVault" ? profile.excludeGlobs.length : profile.includeFolders.length;
      name.createDiv({
        cls: columnStatus
          ? [
              "ixplorer-settings-index-list__meta",
              "ixplorer-settings-index-list__status",
              columnStatus.kind,
              columnStatus.animated ? "is-animated" : "",
            ]
              .filter(Boolean)
              .join(" ")
          : "ixplorer-settings-index-list__meta",
        text:
          columnStatus?.label ??
          `${profile.mode === "wholeVault" ? "Whole vault" : "Selected"} · ${paths} paths`,
        attr: columnStatus
          ? { "aria-label": columnStatus.tooltip, "data-tooltip": columnStatus.tooltip }
          : undefined,
      });
      if (enrichment.status !== "idle" && !columnStatus)
        name.createDiv({
          cls: "ixplorer-settings-index-list__meta",
          text: formatEnrichmentStatus(enrichment),
        });
      row.createDiv({
        cls: "ixplorer-settings-index-list__size",
        text: `${formatIndexSize(indexing.indexSizeBytes ?? profile.indexSizeBytes ?? 0)} · ${indexing.indexedFiles + indexing.skippedFiles || profile.indexedFileCount || 0} files`,
      });
      const status = resolveIndexStatusBadge({
        profile,
        indexing,
        enrichment,
        pendingEnrichmentAction,
      });
      if (status)
        row.createSpan({
          cls: `ixplorer-settings-profile-list__status ${status.kind}`,
          text: status.label,
          attr: { title: status.title },
        });
      else row.createSpan({ cls: "ixplorer-settings-profile-list__status-placeholder" });
      this.renderActions(
        row.createDiv({ cls: "ixplorer-settings-profile-list__actions" }),
        profile,
        { busy, indexing, enrichment, pendingIndexAction, pendingEnrichmentAction },
      );
    }
  }

  private renderActions(
    actions: HTMLElement,
    profile: IndexProfile,
    state: {
      busy: string | undefined;
      indexing: ReturnType<IxplorerPlugin["indexing"]["getState"]>;
      enrichment: ReturnType<IxplorerPlugin["enrichment"]["getState"]>;
      pendingIndexAction: IndexPendingAction | undefined;
      pendingEnrichmentAction: EnrichmentPendingAction | undefined;
    },
  ): void {
    const pending = Boolean(state.pendingIndexAction || state.pendingEnrichmentAction);
    const busyElsewhere = state.busy !== undefined && state.busy !== profile.id;
    const running = state.indexing.status === "indexing";
    const paused = state.indexing.status === "paused";
    if (running || paused)
      createIconButton(actions, {
        icon: paused ? "play" : "pause",
        label: paused ? "Continue indexing" : "Pause indexing",
        disabled: busyElsewhere || pending,
        onClick: () =>
          paused ? void this.plugin.indexing.resume(profile.id) : this.pause(profile.id),
      });
    else if (this.plugin.enrichment.isRunning(profile.id))
      createIconButton(actions, {
        icon: "circle-x",
        label: "Stop metadata extraction",
        disabled: pending,
        onClick: () => this.stopEnrichment(profile.id),
      });
    else
      createIconButton(actions, {
        icon: profile.lastIndexedAt ? "history" : "play",
        label: profile.lastIndexedAt ? "Update index" : "Start indexing",
        disabled: profile.isSuspended === true || busyElsewhere || pending,
        onClick: () => void this.openRunModal(profile),
      });
    createIconButton(actions, {
      icon: "file-text",
      label: "Show index report",
      disabled: pending,
      onClick: () => void this.openReportModal(profile),
    });
    createIconButton(actions, {
      icon: "pencil",
      label: "Edit index profile",
      disabled: pending,
      onClick: () => this.openEditModal(profile),
    });
    createIconButton(actions, {
      icon: "trash",
      label: "Delete index profile",
      disabled: pending,
      onClick: () => void this.delete(profile.id),
    });
  }

  private syncPending(
    id: string,
    status: string,
    activeOperation: string | undefined,
    enrichmentStatus: string,
  ): void {
    if (
      this.pendingIndexActions.get(id) === "pausing" &&
      !(status === "indexing" || activeOperation)
    )
      this.pendingIndexActions.delete(id);
    if (this.pendingEnrichmentActions.get(id) === "stopping" && enrichmentStatus !== "running")
      this.pendingEnrichmentActions.delete(id);
  }
  private pause(id: string): void {
    this.pendingIndexActions.set(id, "pausing");
    this.plugin.indexing.pause(id);
  }
  private stopEnrichment(id: string): void {
    this.pendingEnrichmentActions.set(id, "stopping");
    this.plugin.enrichment.cancel(id);
    this.requestRedisplay();
  }
  private openAddModal(): void {
    const settings = this.plugin.settings;
    if (settings.indexProfiles.length >= MAX_INDEX_PROFILE_COUNT) {
      new Notice(`You can create up to ${MAX_INDEX_PROFILE_COUNT} index profiles.`);
      return;
    }
    if (!settings.embeddingModelProfiles.some((profile) => !profile.isSuspended)) {
      new Notice("Create an active embedding model before adding an index.");
      return;
    }
    new IndexProfileModal(this.app, {
      profiles: settings.indexProfiles,
      embeddingModels: settings.embeddingModelProfiles,
      defaultEmbeddingModelProfileId: settings.activeEmbeddingModelProfileId,
      onSave: async (profile) => {
        settings.indexProfiles.push(profile);
        if (!settings.newChatDefaults.indexProfileId || getActiveIndexProfile(settings).isSuspended)
          settings.newChatDefaults.indexProfileId = profile.id;
        await this.saveAndRedisplay();
      },
    }).open();
  }
  private openEditModal(profile: IndexProfile): void {
    new IndexProfileModal(this.app, {
      profile,
      profiles: this.plugin.settings.indexProfiles,
      embeddingModels: this.plugin.settings.embeddingModelProfiles,
      onSave: async (updated) => {
        Object.assign(profile, updated, { updatedAt: new Date().toISOString() });
        await this.plugin.saveSettings();
        this.plugin.markIndexStale(profile.id);
        this.requestRedisplay();
      },
    }).open();
  }
  private async delete(id: string): Promise<void> {
    this.plugin.settings.indexProfiles = this.plugin.settings.indexProfiles.filter(
      (profile) => profile.id !== id,
    );
    await this.saveAndRedisplay();
  }
  private async openRunModal(profile: IndexProfile): Promise<void> {
    const embeddings = this.plugin.settings.embeddingModelProfiles.filter(
      (item) => !item.isSuspended,
    );
    if (embeddings.length === 0) {
      new Notice("Create an active embedding model before indexing.");
      return;
    }
    const chats = this.plugin.settings.chatModelProfiles.filter((item) => !item.isSuspended);
    const metadata = profile.lastIndexedAt ? await this.plugin.loadIndexMetadata(profile.id) : [];
    const hasMetadata = metadata.length > 0;
    if (hasMetadata && !profile.lastEnrichedAt) {
      const latest = metadata
        .map((item) => item.extraction.extractedAt)
        .sort()
        .at(-1);
      if (latest) {
        profile.lastEnrichedAt = latest;
        await this.plugin.saveSettings();
      }
    }
    new IndexRunModal(this.app, {
      profile,
      hasMetadata,
      embeddingModels: embeddings,
      chatModels: chats,
      defaultChatModelProfileId: this.plugin.settings.newChatDefaults.chatModelProfileId,
      onSubmit: (plan) => {
        if (plan.metadata && chats.length === 0) {
          new Notice("Create an active chat model profile before extracting metadata.");
          return;
        }
        void this.plugin.runIndexPlan(profile.id, plan);
      },
    }).open();
  }
  private async openReportModal(profile: IndexProfile): Promise<void> {
    try {
      const report = await this.plugin.loadIndexReport(profile.id);
      const metadata = await this.plugin.loadIndexMetadata(profile.id);
      const summaries = await this.plugin.loadIndexSummaries(profile.id);
      new IndexReportModal(this.app, { profile, report, metadata, summaries }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not load index report.");
    }
  }
  private async saveAndRedisplay(): Promise<void> {
    await this.plugin.saveSettings();
    this.requestRedisplay();
  }
}
