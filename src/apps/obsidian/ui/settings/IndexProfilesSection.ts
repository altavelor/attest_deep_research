import type IxplorerPlugin from "@apps/obsidian/main";
import { IndexProfile, formatIndexSize } from "@adapters/indexing";
import { MAX_INDEX_PROFILE_COUNT, getActiveIndexProfile } from "@adapters/settings";
import { App, Notice, Setting } from "obsidian";
import type { Translate } from "@adapters/i18n";
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

  private get t(): Translate {
    return this.plugin.translate;
  }

  dispose(): void {
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    this.unsubscribeEnrichment?.();
    this.unsubscribeEnrichment = null;
  }

  render(containerEl: HTMLElement): void {
    const t = this.t;
    new Setting(containerEl).setName(t("settings.indexing.heading")).setHeading();
    const section = containerEl.createDiv({ cls: "ixplorer-settings-profile-section" });
    const header = section.createDiv({ cls: "ixplorer-settings-profile-section__header" });
    header.createEl("h3", { text: t("settings.indexProfiles.title") });
    createIconButton(header, {
      icon: "plus",
      label: t("settings.indexProfiles.addAction"),
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
    for (const title of [
      t("settings.indexProfiles.column.index"),
      t("settings.indexProfiles.column.size"),
      t("settings.indexProfiles.column.status"),
      t("settings.indexProfiles.column.actions"),
    ])
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
    const t = this.t;
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
        t,
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
          t("settings.indexProfiles.meta", {
            mode:
              profile.mode === "wholeVault"
                ? t("settings.indexProfiles.mode.wholeVault")
                : t("settings.indexProfiles.mode.selected"),
            paths,
          }),
        attr: columnStatus
          ? { "aria-label": columnStatus.tooltip, "data-tooltip": columnStatus.tooltip }
          : undefined,
      });
      if (enrichment.status !== "idle" && !columnStatus)
        name.createDiv({
          cls: "ixplorer-settings-index-list__meta",
          text: formatEnrichmentStatus(t, enrichment),
        });
      row.createDiv({
        cls: "ixplorer-settings-index-list__size",
        text: t("settings.indexProfiles.size", {
          size: formatIndexSize(indexing.indexSizeBytes ?? profile.indexSizeBytes ?? 0),
          files: indexing.indexedFiles + indexing.skippedFiles || profile.indexedFileCount || 0,
        }),
      });
      const status = resolveIndexStatusBadge({
        t,
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
    const t = this.t;
    const pending = Boolean(state.pendingIndexAction || state.pendingEnrichmentAction);
    const busyElsewhere = state.busy !== undefined && state.busy !== profile.id;
    const running = state.indexing.status === "indexing";
    const paused = state.indexing.status === "paused";
    if (running || paused)
      createIconButton(actions, {
        icon: paused ? "play" : "pause",
        label: paused
          ? t("settings.indexProfiles.action.continueIndexing")
          : t("settings.indexProfiles.action.pauseIndexing"),
        disabled: busyElsewhere || pending,
        onClick: () =>
          paused ? void this.plugin.indexing.resume(profile.id) : this.pause(profile.id),
      });
    else if (this.plugin.enrichment.isRunning(profile.id))
      createIconButton(actions, {
        icon: "circle-x",
        label: t("settings.indexProfiles.action.stopMetadata"),
        disabled: pending,
        onClick: () => this.stopEnrichment(profile.id),
      });
    else
      createIconButton(actions, {
        icon: profile.lastIndexedAt ? "history" : "play",
        label: profile.lastIndexedAt
          ? t("settings.indexProfiles.action.updateIndex")
          : t("settings.indexProfiles.action.startIndexing"),
        disabled: profile.isSuspended === true || busyElsewhere || pending,
        onClick: () => void this.openRunModal(profile),
      });
    createIconButton(actions, {
      icon: "file-text",
      label: t("settings.indexProfiles.action.showReport"),
      disabled: pending,
      onClick: () => void this.openReportModal(profile),
    });
    createIconButton(actions, {
      icon: "pencil",
      label: t("settings.indexProfiles.action.edit"),
      disabled: pending,
      onClick: () => this.openEditModal(profile),
    });
    createIconButton(actions, {
      icon: "trash",
      label: t("settings.indexProfiles.action.delete"),
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
    const t = this.t;
    const settings = this.plugin.settings;
    if (settings.indexProfiles.length >= MAX_INDEX_PROFILE_COUNT) {
      new Notice(t("settings.indexProfiles.notice.maxProfiles", { max: MAX_INDEX_PROFILE_COUNT }));
      return;
    }
    if (!settings.embeddingModelProfiles.some((profile) => !profile.isSuspended)) {
      new Notice(t("settings.indexProfiles.notice.embeddingRequired"));
      return;
    }
    new IndexProfileModal(this.app, {
      t,
      getDirection: () => this.plugin.getTranslator().direction,
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
      t: this.t,
      getDirection: () => this.plugin.getTranslator().direction,
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
    const t = this.t;
    const embeddings = this.plugin.settings.embeddingModelProfiles.filter(
      (item) => !item.isSuspended,
    );
    if (embeddings.length === 0) {
      new Notice(t("settings.indexProfiles.notice.embeddingRequiredForRun"));
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
      t,
      getDirection: () => this.plugin.getTranslator().direction,
      profile,
      hasMetadata,
      embeddingModels: embeddings,
      chatModels: chats,
      defaultChatModelProfileId: this.plugin.settings.newChatDefaults.chatModelProfileId,
      onSubmit: (plan) => {
        if (plan.metadata && chats.length === 0) {
          new Notice(t("settings.indexProfiles.notice.chatRequiredForMetadata"));
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
      new IndexReportModal(this.app, {
        t: this.t,
        getDirection: () => this.plugin.getTranslator().direction,
        getLocale: () => this.plugin.getTranslator().locale,
        profile,
        report,
        metadata,
        summaries,
      }).open();
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : this.t("settings.indexProfiles.notice.reportFailed"),
      );
    }
  }
  private async saveAndRedisplay(): Promise<void> {
    await this.plugin.saveSettings();
    this.requestRedisplay();
  }
}
