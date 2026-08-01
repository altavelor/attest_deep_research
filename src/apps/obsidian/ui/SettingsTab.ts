import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";

import type IxplorerPlugin from "@apps/obsidian/main";
import { IndexProfile } from "@adapters/indexing";
import { formatIndexSize } from "@adapters/indexing";
import { DiscoveredModel } from "@adapters/settings";
import { MAX_INDEX_PROFILE_COUNT } from "@adapters/settings";
import { normalizeSettingsState } from "@adapters/settings";
import { getActiveIndexProfile } from "@adapters/settings";
import { SettingsCapabilityProber } from "./settings/SettingsCapabilityProber";
import { IndexRunModal } from "./settings/IndexRunModal";
import { IndexReportModal } from "./settings/IndexReportModal";
import { IndexProfileModal } from "./settings/IndexProfileModal";
import {
  resolveIndexProfileColumnStatus,
  resolveIndexStatusBadge,
} from "./settings/indexProfileStatus";
import type { EnrichmentPendingAction, IndexPendingAction } from "./settings/indexProfileStatus";
import { RetrievalSettingsSection } from "./settings/RetrievalSettingsSection";
import { ModelProfilesSection } from "./settings/ModelProfilesSection";
import { createIconButton, formatEnrichmentStatus, renderCategoryHeading } from "./settings/shared";

export class IxplorerSettingTab extends PluginSettingTab {
  private unsubscribeIndexing: (() => void) | null = null;
  private unsubscribeEnrichment: (() => void) | null = null;
  private unsubscribeCapabilityProbes: (() => void) | null = null;
  private readonly fetchedModelsByServerId = new Map<string, DiscoveredModel[]>();
  private readonly pendingIndexActions = new Map<string, IndexPendingAction>();
  private readonly pendingEnrichmentActions = new Map<string, EnrichmentPendingAction>();
  private metadataRefreshStarted = false;
  private readonly prober: SettingsCapabilityProber;

  constructor(
    app: App,
    private readonly plugin: IxplorerPlugin,
  ) {
    super(app, plugin);
    this.prober = new SettingsCapabilityProber({
      plugin: this.plugin,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      requestRedisplay: () => this.display(),
    });
  }

  display(): void {
    const { containerEl } = this;
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    this.unsubscribeEnrichment?.();
    this.unsubscribeEnrichment = null;
    this.unsubscribeCapabilityProbes?.();
    this.unsubscribeCapabilityProbes = this.prober.subscribeAll(() => {
      window.setTimeout(() => this.display(), 0);
    });
    normalizeSettingsState(this.plugin.settings);
    containerEl.empty();
    containerEl.addClass("ixplorer-settings");

    renderCategoryHeading(containerEl, "Ixplorer");
    this.renderQuickStart(containerEl);
    this.renderProfileSettings(containerEl);
    this.renderIndexingSettings(containerEl);
    new RetrievalSettingsSection({
      app: this.app,
      settings: this.plugin.settings,
      webSourceHealth: this.plugin.webSourceHealth,
      hasActiveChatModel: this.hasActiveChatModel(),
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(containerEl);
    this.renderAdvancedSettings(containerEl);
    if (!this.metadataRefreshStarted) {
      this.metadataRefreshStarted = true;
      void this.prober.refreshMetadataCapabilities();
    }
  }

  private hasActiveChatModel(): boolean {
    return this.plugin.settings.chatModelProfiles.some((profile) => profile.isSuspended !== true);
  }

  private renderQuickStart(containerEl: HTMLElement): void {
    if (this.plugin.settings.serverProfiles.length > 0) {
      return;
    }

    const banner = containerEl.createDiv({ cls: "ixplorer-settings__quickstart" });
    setIcon(banner.createSpan({ cls: "ixplorer-settings__quickstart-icon" }), "rocket");
    const body = banner.createDiv({ cls: "ixplorer-settings__quickstart-body" });
    body.createDiv({
      cls: "ixplorer-settings__quickstart-title",
      text: "Quick start",
    });
    body.createDiv({
      cls: "ixplorer-settings__quickstart-steps",
      text: "1. Add a server → 2. Add a chat model → 3. (optional) Add an index",
    });
  }

  private gateHost(containerEl: HTMLElement): HTMLElement {
    if (this.hasActiveChatModel()) {
      return containerEl;
    }

    const section = containerEl.createDiv({ cls: "ixplorer-settings__gated-section" });
    const hint = section.createDiv({ cls: "ixplorer-settings__gate-hint" });
    setIcon(hint.createSpan({ cls: "ixplorer-settings__gate-hint-icon" }), "info");
    hint.createSpan({ text: "Add a chat model profile first" });
    return section.createDiv({
      cls: "ixplorer-settings__gated-content is-disabled",
      attr: { "aria-disabled": "true", inert: "" },
    });
  }

  private renderDebugSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Log plugin request and response details. API keys are redacted.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
          this.plugin.refreshChatViews();
        }),
      );
  }

  private renderAdvancedSettings(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", {
      cls: "ixplorer-settings-advanced",
    });
    details.createEl("summary", {
      cls: "ixplorer-settings-advanced__summary",
      text: "Advanced",
    });

    const contentEl = details.createDiv({ cls: "ixplorer-settings-advanced__content" });
    this.renderDebugSettings(contentEl);
  }

  private renderProfileSettings(containerEl: HTMLElement): void {
    new ModelProfilesSection({
      app: this.app,
      settings: this.plugin.settings,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      prober: this.prober,
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(containerEl);
  }

  private renderIndexingSettings(containerEl: HTMLElement): void {
    containerEl = this.gateHost(containerEl);
    new Setting(containerEl).setName("Indexing").setHeading();

    const section = containerEl.createDiv({ cls: "ixplorer-settings-profile-section" });
    const header = section.createDiv({ cls: "ixplorer-settings-profile-section__header" });
    header.createEl("h3", { text: "Index profiles" });
    createIconButton(header, {
      icon: "plus",
      label: "Add index profile",
      disabled: this.plugin.settings.indexProfiles.length >= MAX_INDEX_PROFILE_COUNT,
      onClick: () => this.openAddIndexProfileModal(),
    });

    const table = section.createDiv({
      cls: "ixplorer-settings-profile-table ixplorer-settings-index-table",
    });
    const tableHeader = table.createDiv({
      cls: "ixplorer-settings-profile-table__header ixplorer-settings-index-table__header",
      attr: { role: "row" },
    });
    tableHeader.createSpan({ text: "Index" });
    tableHeader.createSpan({ text: "Size" });
    tableHeader.createSpan({ text: "Status" });
    tableHeader.createSpan({ text: "Actions" });
    const listEl = table.createDiv({ cls: "ixplorer-settings-profile-list" });

    const renderRows = () => {
      listEl.empty();
      this.renderIndexProfileRows(listEl);
    };
    renderRows();
    this.unsubscribeIndexing = this.plugin.indexing.subscribeAll(renderRows);
    this.unsubscribeEnrichment = this.plugin.enrichment.subscribeAll(renderRows);
  }

  private renderIndexProfileRows(containerEl: HTMLElement): void {
    const busyProfileId = this.plugin.indexing.getBusyProfileId();

    for (const profile of this.plugin.settings.indexProfiles) {
      const state = this.plugin.indexing.getState(profile.id);
      const enrichment = this.plugin.enrichment.getState(profile.id);
      this.syncPendingIndexActions(profile.id, state.status, state.activeOperation);
      this.syncPendingEnrichmentActions(profile.id, enrichment.status);
      const pendingIndexAction = this.pendingIndexActions.get(profile.id);
      const pendingEnrichmentAction = this.pendingEnrichmentActions.get(profile.id);
      const isDefault = this.plugin.settings.activeIndexProfileId === profile.id;
      const row = containerEl.createDiv({
        cls: "ixplorer-settings-profile-list__item ixplorer-settings-index-list__item",
      });
      const nameEl = row.createDiv({ cls: "ixplorer-settings-profile-list__name" });
      nameEl.createDiv({ cls: "ixplorer-settings-index-list__title", text: profile.name });
      const pathCount =
        profile.mode === "wholeVault" ? profile.excludeGlobs.length : profile.includeFolders.length;
      const columnStatus = resolveIndexProfileColumnStatus({
        indexing: state,
        enrichment,
        pendingIndexAction,
        pendingEnrichmentAction,
      });
      const metaClass = columnStatus
        ? [
            "ixplorer-settings-index-list__meta",
            "ixplorer-settings-index-list__status",
            columnStatus.kind,
            columnStatus.animated ? "is-animated" : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "ixplorer-settings-index-list__meta";
      nameEl.createDiv({
        cls: metaClass,
        text:
          columnStatus?.label ??
          `${profile.mode === "wholeVault" ? "Whole vault" : "Selected"} · ${pathCount} paths`,
        attr: columnStatus
          ? { "aria-label": columnStatus.tooltip, "data-tooltip": columnStatus.tooltip }
          : undefined,
      });
      if (enrichment.status !== "idle" && !columnStatus) {
        nameEl.createDiv({
          cls: "ixplorer-settings-index-list__meta",
          text: formatEnrichmentStatus(enrichment),
        });
      }
      row.createDiv({
        cls: "ixplorer-settings-index-list__size",
        text: `${formatIndexSize(state.indexSizeBytes ?? profile.indexSizeBytes ?? 0)} · ${
          state.indexedFiles + state.skippedFiles || profile.indexedFileCount || 0
        } files`,
      });
      const status = resolveIndexStatusBadge({
        isDefault,
        profile,
        indexing: state,
        enrichment,
        pendingEnrichmentAction,
      });
      if (status) {
        row.createSpan({
          cls: `ixplorer-settings-profile-list__status ${status.kind}`,
          text: status.label,
          attr: { title: status.title },
        });
      } else {
        row.createSpan({ cls: "ixplorer-settings-profile-list__status-placeholder" });
      }

      const actions = row.createDiv({ cls: "ixplorer-settings-profile-list__actions" });
      const isBusyElsewhere = busyProfileId !== undefined && busyProfileId !== profile.id;
      const isRunning = state.status === "indexing";
      const isPaused = state.status === "paused";
      const isEnriching = this.plugin.enrichment.isRunning(profile.id);
      const canRun = profile.isSuspended !== true && !isBusyElsewhere;
      const isActionPending = Boolean(pendingIndexAction || pendingEnrichmentAction);

      if (isRunning || isPaused) {
        createIconButton(actions, {
          icon: isPaused ? "play" : "pause",
          label: isPaused ? "Continue indexing" : "Pause indexing",
          disabled: isBusyElsewhere || isActionPending,
          onClick: () =>
            isPaused
              ? void this.plugin.indexing.resume(profile.id)
              : this.pauseIndexing(profile.id),
        });
      } else if (isEnriching) {
        createIconButton(actions, {
          icon: "circle-x",
          label: "Stop metadata extraction",
          disabled: isActionPending,
          onClick: () => this.stopMetadataExtraction(profile.id),
        });
      } else {
        createIconButton(actions, {
          icon: profile.lastIndexedAt ? "history" : "play",
          label: profile.lastIndexedAt ? "Update index" : "Start indexing",
          disabled: !canRun || isActionPending,
          onClick: () => void this.openIndexRunModal(profile),
        });
      }

      createIconButton(actions, {
        icon: "star",
        className: "ixplorer-settings__default-action",
        label: isDefault ? "Default index" : "Set as default index",
        disabled:
          isActionPending || isDefault || profile.isSuspended === true || !profile.lastIndexedAt,
        onClick: async () => {
          this.plugin.settings.activeIndexProfileId = profile.id;
          await this.plugin.saveSettings();
          this.display();
        },
      });
      createIconButton(actions, {
        icon: "file-text",
        label: "Show index report",
        disabled: isActionPending,
        onClick: () => void this.openIndexReportModal(profile),
      });
      createIconButton(actions, {
        icon: "pencil",
        label: "Edit index profile",
        disabled: isActionPending,
        onClick: () => this.openEditIndexProfileModal(profile),
      });
      createIconButton(actions, {
        icon: "trash",
        label: "Delete index profile",
        disabled: isActionPending,
        onClick: () => void this.deleteIndexProfile(profile.id),
      });
    }
  }

  private syncPendingIndexActions(
    profileId: string,
    status: string,
    activeOperation: string | undefined,
  ): void {
    if (
      this.pendingIndexActions.get(profileId) === "pausing" &&
      !(status === "indexing" || activeOperation)
    ) {
      this.pendingIndexActions.delete(profileId);
    }
  }

  private syncPendingEnrichmentActions(profileId: string, status: string): void {
    if (this.pendingEnrichmentActions.get(profileId) === "stopping" && status !== "running") {
      this.pendingEnrichmentActions.delete(profileId);
    }
  }

  private pauseIndexing(profileId: string): void {
    this.pendingIndexActions.set(profileId, "pausing");
    this.plugin.indexing.pause(profileId);
  }

  private stopMetadataExtraction(profileId: string): void {
    this.pendingEnrichmentActions.set(profileId, "stopping");
    this.plugin.enrichment.cancel(profileId);
    this.display();
  }

  private openAddIndexProfileModal(): void {
    if (this.plugin.settings.indexProfiles.length >= MAX_INDEX_PROFILE_COUNT) {
      new Notice(`You can create up to ${MAX_INDEX_PROFILE_COUNT} index profiles.`);
      return;
    }

    const embeddingModel = this.plugin.settings.embeddingModelProfiles.find(
      (profile) => profile.isSuspended !== true,
    );
    if (!embeddingModel) {
      new Notice("Create an active embedding model before adding an index.");
      return;
    }

    new IndexProfileModal(this.app, {
      profiles: this.plugin.settings.indexProfiles,
      embeddingModels: this.plugin.settings.embeddingModelProfiles,
      defaultEmbeddingModelProfileId: this.plugin.settings.activeEmbeddingModelProfileId,
      onSave: async (profile) => {
        this.plugin.settings.indexProfiles.push(profile);
        if (
          !this.plugin.settings.activeIndexProfileId ||
          getActiveIndexProfile(this.plugin.settings).isSuspended
        ) {
          this.plugin.settings.activeIndexProfileId = profile.id;
        }
        await this.plugin.saveSettings();
        this.display();
      },
    }).open();
  }

  private openEditIndexProfileModal(profile: IndexProfile): void {
    new IndexProfileModal(this.app, {
      profile,
      profiles: this.plugin.settings.indexProfiles,
      embeddingModels: this.plugin.settings.embeddingModelProfiles,
      onSave: async (updatedProfile) => {
        Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
        await this.plugin.saveSettings();
        this.plugin.markIndexStale(profile.id);
        this.display();
      },
    }).open();
  }

  private async deleteIndexProfile(profileId: string): Promise<void> {
    this.plugin.settings.indexProfiles = this.plugin.settings.indexProfiles.filter(
      (profile) => profile.id !== profileId,
    );
    await this.plugin.saveSettings();
    this.display();
  }

  private async openIndexRunModal(profile: IndexProfile): Promise<void> {
    const embeddingModels = this.plugin.settings.embeddingModelProfiles.filter(
      (candidate) => candidate.isSuspended !== true,
    );
    if (embeddingModels.length === 0) {
      new Notice("Create an active embedding model before indexing.");
      return;
    }
    const chatModels = this.plugin.settings.chatModelProfiles.filter(
      (candidate) => candidate.isSuspended !== true,
    );
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
      embeddingModels,
      chatModels,
      defaultChatModelProfileId: this.plugin.settings.activeChatModelProfileId,
      onSubmit: (plan) => {
        if (plan.metadata && chatModels.length === 0) {
          new Notice("Create an active chat model profile before extracting metadata.");
          return;
        }
        void this.plugin.runIndexPlan(profile.id, plan);
      },
    }).open();
  }

  private async openIndexReportModal(profile: IndexProfile): Promise<void> {
    try {
      const report = await this.plugin.loadIndexReport(profile.id);
      const metadata = await this.plugin.loadIndexMetadata(profile.id);
      const summaries = await this.plugin.loadIndexSummaries(profile.id);
      new IndexReportModal(this.app, { profile, report, metadata, summaries }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not load index report.");
    }
  }
}
