import {
  App,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  TFolder,
  setIcon,
} from "obsidian";

import type IxplorerPlugin from "../main";
import { IndexingState, IndexSourceReportItem } from "../indexing/IndexingService";
import { IndexProfile } from "../indexing/FileVectorIndexStore";
import { formatIndexSize } from "../indexing/indexSize";
import { parseNonNegativeInteger, parsePositiveInteger } from "../shared/numbers";
import { normalizeVaultPath, vaultPathMatchesGlob } from "../shared/pathFilters";
import { ApiFormat } from "../shared/types";
import {
  fetchAvailableModels,
  verifyEmbeddingCapability,
  DiscoveredModel,
} from "./connectionTests";
import { DUCK_DUCK_GO_DESCRIPTION } from "./privacyCopy";
import {
  ChatModelProfile,
  DEFAULT_INDEX_PROFILE,
  EmbeddingModelProfile,
  ServerProfile,
  MAX_INDEX_PROFILE_COUNT,
  canDeleteEmbeddingModelProfile,
  canDeleteServerProfile,
  createIndexProfile,
  createProfileId,
  getActiveIndexProfile,
  hasDuplicateProfileName,
  isValidIndexProfileName,
  normalizeSettingsState,
  normalizeUrl,
} from "./settings";

export class IxplorerSettingTab extends PluginSettingTab {
  private unsubscribeIndexing: (() => void) | null = null;
  private readonly fetchedModelsByServerId = new Map<string, DiscoveredModel[]>();

  constructor(
    app: App,
    private readonly plugin: IxplorerPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    this.unsubscribeIndexing?.();
    this.unsubscribeIndexing = null;
    normalizeSettingsState(this.plugin.settings);
    containerEl.empty();
    containerEl.addClass("ixplorer-settings");

    new Setting(containerEl).setName("Ixplorer").setHeading();
    this.renderDebugSettings(containerEl);
    this.renderProfileSettings(containerEl);
    this.renderIndexingSettings(containerEl);
    this.renderWebSearchSettings(containerEl);
  }

  private renderDebugSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Debug mode")
      .setDesc("Log plugin request and response details. API keys are redacted.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.debugMode).onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }),
      );
  }

  private renderProfileSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Model profiles")
      .setDesc("Configure provider endpoints and the chat or embedding models that use them.")
      .setHeading();

    this.renderServerProfiles(containerEl);
    this.renderChatModelProfiles(containerEl);
    this.renderEmbeddingModelProfiles(containerEl);
  }

  private renderServerProfiles(containerEl: HTMLElement): void {
    const listEl = this.renderProfileList(containerEl, "Server profiles", () => {
      new ServerProfileModal(this.app, {
        profiles: this.plugin.settings.serverProfiles,
        onSave: async (profile) => {
          this.plugin.settings.serverProfiles.push(profile);
          await this.plugin.saveSettings();
          this.display();
        },
      }).open();
    });

    for (const profile of this.plugin.settings.serverProfiles) {
      this.renderProfileListItem(listEl, {
        name: profile.name,
        status: statusForProfile(profile),
        onEdit: () => {
          new ServerProfileModal(this.app, {
            profile,
            profiles: this.plugin.settings.serverProfiles,
            onSave: async (updatedProfile) => {
              Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
              this.fetchedModelsByServerId.delete(profile.id);
              await this.plugin.saveSettings();
              this.display();
            },
          }).open();
        },
        canDelete: canDeleteServerProfile(this.plugin.settings, profile.id),
        deleteTooltip: canDeleteServerProfile(this.plugin.settings, profile.id)
          ? "Delete server profile"
          : "Delete dependent model profiles first",
        onDelete: async () => {
          if (!canDeleteServerProfile(this.plugin.settings, profile.id)) {
            new Notice("Delete dependent model profiles first.");
            return;
          }
          this.plugin.settings.serverProfiles = this.plugin.settings.serverProfiles.filter(
            (candidate) => candidate.id !== profile.id,
          );
          await this.plugin.saveSettings();
          this.display();
        },
      });
    }
  }

  private renderChatModelProfiles(containerEl: HTMLElement): void {
    const listEl = this.renderProfileList(containerEl, "Chat model profiles", () => {
      new ModelProfileModal(this.app, {
        kind: "chat",
        servers: this.plugin.settings.serverProfiles,
        profiles: this.plugin.settings.chatModelProfiles,
        fetchedModelsByServerId: this.fetchedModelsByServerId,
        fetchModels: (server) => this.fetchModelsForServer(server),
        onSave: async (profile) => {
          this.plugin.settings.chatModelProfiles.push(profile);
          if (this.plugin.settings.chatModelProfiles.length === 1) {
            this.plugin.settings.activeChatModelProfileId = profile.id;
          }
          await this.plugin.saveSettings();
          this.display();
        },
      }).open();
    });

    for (const profile of this.plugin.settings.chatModelProfiles) {
      this.renderProfileListItem(listEl, {
        name: profile.name,
        status:
          this.plugin.settings.activeChatModelProfileId === profile.id && !profile.isSuspended
            ? { kind: "is-default", label: "Default", title: "Default chat model" }
            : statusForProfile(profile),
        onEdit: () => {
          new ModelProfileModal(this.app, {
            kind: "chat",
            profile,
            servers: this.plugin.settings.serverProfiles,
            profiles: this.plugin.settings.chatModelProfiles,
            fetchedModelsByServerId: this.fetchedModelsByServerId,
            fetchModels: (server) => this.fetchModelsForServer(server),
            onSave: async (updatedProfile) => {
              Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
              await this.plugin.saveSettings();
              this.display();
            },
          }).open();
        },
        extraActions: [
          {
            icon: "star",
            className: "ixplorer-settings__default-action",
            label:
              this.plugin.settings.activeChatModelProfileId === profile.id
                ? "Default model"
                : "Set as default model",
            hidden: this.plugin.settings.activeChatModelProfileId === profile.id,
            disabled:
              profile.isSuspended === true ||
              this.plugin.settings.activeChatModelProfileId === profile.id,
            onClick: async () => {
              this.plugin.settings.activeChatModelProfileId = profile.id;
              await this.plugin.saveSettings();
              this.display();
            },
          },
        ],
        canDelete: true,
        deleteTooltip: "Delete chat model profile",
        onDelete: async () => {
          this.plugin.settings.chatModelProfiles = this.plugin.settings.chatModelProfiles.filter(
            (candidate) => candidate.id !== profile.id,
          );
          await this.plugin.saveSettings();
          this.display();
        },
      });
    }
  }

  private renderEmbeddingModelProfiles(containerEl: HTMLElement): void {
    const listEl = this.renderProfileList(containerEl, "Embedding model profiles", () => {
      new ModelProfileModal(this.app, {
        kind: "embedding",
        servers: this.plugin.settings.serverProfiles,
        profiles: this.plugin.settings.embeddingModelProfiles,
        fetchedModelsByServerId: this.fetchedModelsByServerId,
        fetchModels: (server) => this.fetchModelsForServer(server),
        verifyEmbedding: (server, modelName) => this.verifyEmbeddingForServer(server, modelName),
        onSave: async (profile) => {
          this.plugin.settings.embeddingModelProfiles.push(profile);
          await this.plugin.saveSettings();
          this.display();
        },
      }).open();
    });

    for (const profile of this.plugin.settings.embeddingModelProfiles) {
      this.renderProfileListItem(listEl, {
        name: profile.name,
        status: statusForProfile(profile),
        onEdit: () => {
          new ModelProfileModal(this.app, {
            kind: "embedding",
            profile,
            servers: this.plugin.settings.serverProfiles,
            profiles: this.plugin.settings.embeddingModelProfiles,
            fetchedModelsByServerId: this.fetchedModelsByServerId,
            fetchModels: (server) => this.fetchModelsForServer(server),
            verifyEmbedding: (server, modelName) =>
              this.verifyEmbeddingForServer(server, modelName),
            onSave: async (updatedProfile) => {
              Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
              await this.plugin.saveSettings();
              this.display();
            },
          }).open();
        },
        canDelete: canDeleteEmbeddingModelProfile(this.plugin.settings, profile.id),
        deleteTooltip: canDeleteEmbeddingModelProfile(this.plugin.settings, profile.id)
          ? "Delete embedding model profile"
          : "This embedding model is used by an index profile",
        onDelete: async () => {
          if (!canDeleteEmbeddingModelProfile(this.plugin.settings, profile.id)) {
            new Notice("This embedding model is used by an index profile.");
            return;
          }
          this.plugin.settings.embeddingModelProfiles =
            this.plugin.settings.embeddingModelProfiles.filter(
              (candidate) => candidate.id !== profile.id,
            );
          await this.plugin.saveSettings();
          this.display();
        },
      });
    }
  }

  private renderProfileList(
    containerEl: HTMLElement,
    title: string,
    onAdd: () => void,
  ): HTMLElement {
    const section = containerEl.createDiv({ cls: "ixplorer-settings-profile-section" });
    const header = section.createDiv({ cls: "ixplorer-settings-profile-section__header" });
    header.createEl("h3", { text: title });
    createIconButton(header, {
      icon: "plus",
      label: `Add ${title.toLowerCase()}`,
      onClick: onAdd,
    });

    const table = section.createDiv({ cls: "ixplorer-settings-profile-table" });
    const tableHeader = table.createDiv({
      cls: "ixplorer-settings-profile-table__header",
      attr: { role: "row" },
    });
    tableHeader.createSpan({ text: "Profile" });
    tableHeader.createSpan({ text: "Status" });
    tableHeader.createSpan({ text: "Actions" });
    return table.createDiv({ cls: "ixplorer-settings-profile-list" });
  }

  private renderProfileListItem(
    containerEl: HTMLElement,
    options: {
      name: string;
      status: ProfileStatus | null;
      canDelete: boolean;
      deleteTooltip: string;
      extraActions?: Array<{
        icon: string;
        className?: string;
        label: string;
        hidden?: boolean;
        disabled?: boolean;
        onClick(): void | Promise<void>;
      }>;
      onEdit(): void;
      onDelete(): void | Promise<void>;
    },
  ): void {
    const row = containerEl.createDiv({ cls: "ixplorer-settings-profile-list__item" });
    row.createDiv({ cls: "ixplorer-settings-profile-list__name", text: options.name });
    if (options.status) {
      row.createSpan({
        cls: `ixplorer-settings-profile-list__status ${options.status.kind}`,
        text: options.status.label,
        attr: { title: options.status.title },
      });
    } else {
      row.createSpan({ cls: "ixplorer-settings-profile-list__status-placeholder" });
    }
    const actions = row.createDiv({ cls: "ixplorer-settings-profile-list__actions" });
    const defaultAction = options.extraActions?.[0];
    const defaultSlot = actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" });
    if (defaultAction && !defaultAction.hidden) {
      createIconButton(defaultSlot, {
        icon: defaultAction.icon,
        className: defaultAction.className,
        label: defaultAction.label,
        disabled: defaultAction.disabled,
        onClick: () => void defaultAction.onClick(),
      });
    }
    for (const action of options.extraActions ?? []) {
      if (action === defaultAction || action.hidden) {
        continue;
      }
      createIconButton(actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" }), {
        icon: action.icon,
        className: action.className,
        label: action.label,
        disabled: action.disabled,
        onClick: () => void action.onClick(),
      });
    }
    createIconButton(actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" }), {
      icon: "pencil",
      label: "Edit profile",
      onClick: options.onEdit,
    });
    createIconButton(actions.createSpan({ cls: "ixplorer-settings-profile-list__action-slot" }), {
      icon: "trash",
      label: options.deleteTooltip,
      disabled: !options.canDelete,
      onClick: () => void options.onDelete(),
    });
  }

  private async fetchModelsForServer(server: ServerProfile): Promise<DiscoveredModel[]> {
    const result = await fetchAvailableModels(server, { logger: this.plugin.logger });
    this.fetchedModelsByServerId.set(server.id, result.models);
    new Notice(result.message);
    return result.models;
  }

  private async verifyEmbeddingForServer(
    server: ServerProfile,
    modelName: string,
  ): Promise<boolean> {
    return verifyEmbeddingCapability(server, modelName, { logger: this.plugin.logger });
  }

  private renderIndexingSettings(containerEl: HTMLElement): void {
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
  }

  private renderIndexProfileRows(containerEl: HTMLElement): void {
    const busyProfileId = this.plugin.indexing.getBusyProfileId();

    for (const profile of this.plugin.settings.indexProfiles) {
      const state = this.plugin.indexing.getState(profile.id);
      const isDefault = this.plugin.settings.activeIndexProfileId === profile.id;
      const row = containerEl.createDiv({
        cls: "ixplorer-settings-profile-list__item ixplorer-settings-index-list__item",
      });
      const nameEl = row.createDiv({ cls: "ixplorer-settings-profile-list__name" });
      nameEl.createDiv({ text: profile.name });
      const pathCount =
        profile.mode === "wholeVault" ? profile.excludeGlobs.length : profile.includeFolders.length;
      const progressText =
        state.status === "indexing" || state.status === "paused"
          ? formatIndexRowProgress(state)
          : "";
      nameEl.createDiv({
        cls: "ixplorer-settings-index-list__meta",
        text: `${profile.mode === "wholeVault" ? "Whole vault" : "Selected"} · ${pathCount} paths${progressText}`,
      });
      row.createDiv({
        cls: "ixplorer-settings-index-list__size",
        text: `${formatIndexSize(state.indexSizeBytes ?? profile.indexSizeBytes ?? 0)} · ${
          state.indexedFiles || profile.indexedFileCount || 0
        } files`,
      });
      const status = profile.isSuspended
        ? statusForProfile(profile)
        : isDefault
          ? { kind: "is-default", label: "Default", title: "Default index" }
          : state.status === "error"
            ? {
                kind: "is-suspended",
                label: "Error",
                title: state.errorMessage ?? "Indexing failed",
              }
            : null;
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
      const canRun = profile.isSuspended !== true && !isBusyElsewhere;

      if (isRunning || isPaused) {
        createIconButton(actions, {
          icon: isPaused ? "play" : "pause",
          label: isPaused ? "Continue indexing" : "Pause indexing",
          disabled: isBusyElsewhere,
          onClick: () =>
            isPaused
              ? void this.plugin.indexing.resume(profile.id)
              : this.plugin.indexing.pause(profile.id),
        });
      } else {
        createIconButton(actions, {
          icon: "play",
          label: profile.lastIndexedAt ? "Update index" : "Start indexing",
          disabled: !canRun,
          onClick: () => void this.plugin.indexing.start(profile.id),
        });
      }

      if (profile.lastIndexedAt) {
        createIconButton(actions, {
          icon: "refresh-cw",
          label: "Rebuild index",
          disabled: !canRun || isRunning,
          onClick: () => void this.plugin.indexing.rebuild(profile.id),
        });
      }

      createIconButton(actions, {
        icon: "star",
        className: "ixplorer-settings__default-action",
        label: isDefault ? "Default index" : "Set as default index",
        disabled: isDefault || profile.isSuspended === true || !profile.lastIndexedAt,
        onClick: async () => {
          this.plugin.settings.activeIndexProfileId = profile.id;
          await this.plugin.saveSettings();
          this.display();
        },
      });
      createIconButton(actions, {
        icon: "file-text",
        label: "Show index report",
        onClick: () => void this.openIndexReportModal(profile),
      });
      createIconButton(actions, {
        icon: "pencil",
        label: "Edit index profile",
        onClick: () => this.openEditIndexProfileModal(profile),
      });
      createIconButton(actions, {
        icon: "trash",
        label: "Delete index profile",
        onClick: () => void this.deleteIndexProfile(profile.id),
      });
    }
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

  private async openIndexReportModal(profile: IndexProfile): Promise<void> {
    try {
      const report = await this.plugin.loadIndexReport(profile.id);
      new IndexReportModal(this.app, { profile, report }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not load index report.");
    }
  }

  private renderWebSearchSettings(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Web Search").setHeading();

    new Setting(containerEl)
      .setName("DuckDuckGo")
      .setDesc(DUCK_DUCK_GO_DESCRIPTION)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.duckDuckGoEnabled).onChange(async (value) => {
          this.plugin.settings.duckDuckGoEnabled = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}

interface ProfileStatus {
  kind: "is-default" | "is-suspended";
  label: string;
  title: string;
}

function statusForProfile(profile: {
  isSuspended?: boolean;
  suspendedReason?: string;
}): ProfileStatus | null {
  if (profile.isSuspended) {
    return {
      kind: "is-suspended",
      label: "Suspended",
      title: profile.suspendedReason ?? "Suspended",
    };
  }

  return null;
}

function formatIndexRowProgress(state: IndexingState): string {
  if (state.chunksTotal !== undefined && state.chunksTotal > 0) {
    return ` · ${state.chunksEmbedded ?? 0}/${state.chunksTotal} chunks`;
  }

  return ` · ${Math.round(state.progress * 100)}% · ${state.scannedFiles}/${state.totalFiles} files`;
}

interface IndexReportModalOptions {
  profile: IndexProfile;
  report: IndexSourceReportItem[];
}

class IndexReportModal extends Modal {
  constructor(
    app: App,
    private readonly options: IndexReportModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", { text: `${this.options.profile.name} report` });

    const indexed = this.options.report.filter((item) => item.status === "indexed");
    const failed = this.options.report.filter((item) => item.status === "failed");
    const totalChunks = indexed.reduce((total, item) => total + item.chunkCount, 0);
    const summary = contentEl.createDiv({ cls: "ixplorer-index-report__summary" });
    summary.createDiv({ text: `${indexed.length} indexed files` });
    summary.createDiv({ text: `${failed.length} failed files` });
    summary.createDiv({ text: `${totalChunks} chunks` });

    const list = contentEl.createDiv({ cls: "ixplorer-index-report__list" });
    if (this.options.report.length === 0) {
      list.createDiv({
        cls: "ixplorer-index-report__empty",
        text: "No indexing report is available yet.",
      });
    } else {
      for (const item of this.options.report) {
        const row = list.createDiv({
          cls: `ixplorer-index-report__row is-${item.status}`,
        });
        const title = row.createDiv({ cls: "ixplorer-index-report__path" });
        title.setText(item.sourcePath);
        title.setAttr("title", item.sourcePath);
        row.createDiv({
          cls: "ixplorer-index-report__status",
          text: item.status === "indexed" ? `${item.chunkCount} chunks` : "Failed",
        });
        row.createDiv({
          cls: "ixplorer-index-report__detail",
          text:
            item.status === "failed"
              ? (item.errorMessage ?? "Indexing failed.")
              : formatReportTimestamp(item.indexedAt),
        });
      }
    }

    new Setting(contentEl).setClass("ixplorer-profile-modal__actions").addButton((button) =>
      button
        .setCta()
        .setButtonText("Close")
        .onClick(() => this.close()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

interface IndexProfileModalOptions {
  profile?: IndexProfile;
  profiles: IndexProfile[];
  embeddingModels: EmbeddingModelProfile[];
  onSave(profile: IndexProfile): Promise<void>;
}

class IndexProfileModal extends Modal {
  private name = this.options.profile?.name ?? "";
  private mode: IndexProfile["mode"] = this.options.profile?.mode ?? "wholeVault";
  private includeFolders = [...(this.options.profile?.includeFolders ?? [])];
  private excludeGlobs = [...(this.options.profile?.excludeGlobs ?? [])];
  private embeddingModelProfileId =
    this.options.profile?.embeddingModelProfileId ??
    this.options.embeddingModels.find((profile) => profile.isSuspended !== true)?.id ??
    "";
  private chunkSize = String(this.options.profile?.chunkSize ?? DEFAULT_INDEX_PROFILE.chunkSize);
  private chunkOverlap = String(
    this.options.profile?.chunkOverlap ?? DEFAULT_INDEX_PROFILE.chunkOverlap,
  );
  private embeddingBatchSize = String(
    this.options.profile?.embeddingBatchSize ?? DEFAULT_INDEX_PROFILE.embeddingBatchSize,
  );
  private pdfChunkSize = String(
    this.options.profile?.pdfChunkSize ?? DEFAULT_INDEX_PROFILE.pdfChunkSize,
  );
  private pdfChunkOverlap = String(
    this.options.profile?.pdfChunkOverlap ?? DEFAULT_INDEX_PROFILE.pdfChunkOverlap,
  );

  constructor(
    app: App,
    private readonly options: IndexProfileModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", {
      text: this.options.profile ? "Edit index profile" : "Add index profile",
    });

    new Setting(contentEl)
      .setName("Name")
      .setDesc("Unique index name shown in settings, chat, and search selectors.")
      .addText((text) =>
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Mode")
      .setDesc(
        "Whole vault indexes every supported visible file except excluded paths; selected indexes only chosen paths.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("wholeVault", "Whole vault")
          .addOption("selected", "Selected")
          .setValue(this.mode)
          .onChange((value) => {
            this.mode = value === "selected" ? "selected" : "wholeVault";
            if (this.mode === "wholeVault") {
              this.includeFolders = ["/"];
            } else {
              this.excludeGlobs = [];
            }
            this.onOpen();
          }),
      );

    if (this.mode === "selected") {
      this.renderPathSetting(
        contentEl,
        "Included",
        "Files and folders that should be included in this index.",
        this.includeFolders,
        (paths) => {
          this.includeFolders = paths;
          this.onOpen();
        },
      );
    } else {
      this.renderPathSetting(
        contentEl,
        "Excluded",
        "Files and folders that should be excluded from this whole-vault index.",
        this.excludeGlobs,
        (paths) => {
          this.excludeGlobs = paths;
          this.onOpen();
        },
      );
    }

    new Setting(contentEl)
      .setName("Embedding model")
      .setDesc("Embedding model used to generate vectors for this index.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Select embedding model");
        for (const profile of this.options.embeddingModels.filter(
          (candidate) => candidate.isSuspended !== true,
        )) {
          dropdown.addOption(profile.id, profile.name);
        }
        dropdown.setValue(this.embeddingModelProfileId).onChange((value) => {
          this.embeddingModelProfileId = value;
        });
      });

    this.renderNumberSetting(
      contentEl,
      "Chunk size",
      "Maximum text chunk size for non-PDF files.",
      this.chunkSize,
      (value) => {
        this.chunkSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "Chunk overlap",
      "Number of characters shared between adjacent non-PDF chunks.",
      this.chunkOverlap,
      (value) => {
        this.chunkOverlap = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "Embedding batch size",
      "Number of chunks sent in one embedding request.",
      this.embeddingBatchSize,
      (value) => {
        this.embeddingBatchSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "PDF chunk size",
      "Maximum text chunk size for PDF files.",
      this.pdfChunkSize,
      (value) => {
        this.pdfChunkSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "PDF chunk overlap",
      "Number of characters shared between adjacent PDF chunks.",
      this.pdfChunkOverlap,
      (value) => {
        this.pdfChunkOverlap = value;
      },
    );

    renderModalActions(contentEl, {
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderPathSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    paths: string[],
    onChange: (paths: string[]) => void,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addButton((button) =>
        button.setButtonText("Choose").onClick(() => {
          new IndexPathPickerModal(this.app, {
            selectedPaths: paths,
            onSubmit: onChange,
          }).open();
        }),
      );
    const selectedEl = containerEl.createDiv({ cls: "ixplorer-index-path-summary" });
    if (paths.length === 0) {
      selectedEl.createDiv({
        cls: "ixplorer-index-path-summary__empty",
        text: "No paths selected",
      });
      return;
    }

    for (const path of paths) {
      selectedEl.createDiv({
        cls: "ixplorer-index-path-summary__item",
        text: path,
        attr: { title: path },
      });
    }
  }

  private renderNumberSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => void,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text.setValue(value).onChange((nextValue) => onChange(nextValue.trim())));
  }

  private async save(): Promise<void> {
    const chunkSize = parsePositiveInteger(this.chunkSize);
    const chunkOverlap = parseNonNegativeInteger(this.chunkOverlap);
    const embeddingBatchSize = parsePositiveInteger(this.embeddingBatchSize);
    const pdfChunkSize = parsePositiveInteger(this.pdfChunkSize);
    const pdfChunkOverlap = parseNonNegativeInteger(this.pdfChunkOverlap);

    if (!isValidIndexProfileName(this.name)) {
      new Notice(
        "Use a unique name up to 60 characters with letters, numbers, spaces, _, -, ., (, ), [, ].",
      );
      return;
    }

    if (hasDuplicateProfileName(this.options.profiles, this.name, this.options.profile?.id)) {
      new Notice("Name must be unique.");
      return;
    }

    if (!this.embeddingModelProfileId) {
      new Notice("Select an embedding model.");
      return;
    }

    if (this.mode === "selected" && this.includeFolders.length === 0) {
      new Notice("Select at least one included path.");
      return;
    }

    if (
      chunkSize === null ||
      chunkOverlap === null ||
      embeddingBatchSize === null ||
      pdfChunkSize === null ||
      pdfChunkOverlap === null
    ) {
      new Notice("Numeric index settings must be valid whole numbers.");
      return;
    }

    const now = new Date().toISOString();
    const id = this.options.profile?.id ?? createProfileId("index");
    const profile = createIndexProfile({
      ...this.options.profile,
      id,
      name: this.name,
      mode: this.mode,
      indexFolder: this.options.profile?.indexFolder ?? `.ixplorer/indexes/${id}`,
      includeFolders: this.mode === "wholeVault" ? ["/"] : this.includeFolders,
      excludeGlobs: this.mode === "wholeVault" ? this.excludeGlobs : [],
      embeddingModelProfileId: this.embeddingModelProfileId,
      chunkSize,
      chunkOverlap,
      embeddingBatchSize,
      pdfChunkSize,
      pdfChunkOverlap,
      createdAt: this.options.profile?.createdAt ?? now,
      updatedAt: now,
    });

    if (
      this.options.profile?.lastIndexedAt &&
      hasIndexingConfigChanged(this.options.profile, profile)
    ) {
      new Notice("Index settings changed. Rebuild this index to apply the new configuration.");
    }

    await this.options.onSave(profile);
    this.close();
  }
}

interface IndexPathPickerModalOptions {
  selectedPaths: string[];
  onSubmit(paths: string[]): void;
}

class IndexPathPickerModal extends Modal {
  private selectedPaths = new Set(this.options.selectedPaths.map(normalizePickerPath));
  private expandedFolders = new Set<string>();
  private query = "";
  private treeEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly options: IndexPathPickerModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", { text: "Choose files and folders" });

    new Setting(contentEl).setName("Search").addSearch((search) =>
      search.setPlaceholder("Filter files and folders").onChange((value) => {
        this.query = value.trim().toLocaleLowerCase();
        this.renderTree();
      }),
    );

    this.treeEl = contentEl.createDiv({ cls: "ixplorer-index-path-picker" });
    this.renderTree();

    renderModalActions(contentEl, {
      onCancel: () => this.close(),
      onSave: () => {
        this.options.onSubmit(Array.from(this.selectedPaths).sort());
        this.close();
      },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderTree(): void {
    if (!this.treeEl) {
      return;
    }

    this.treeEl.empty();
    if (this.query) {
      this.renderSearchResults(this.treeEl);
      return;
    }

    this.renderFolderChildren(this.treeEl, this.app.vault.getRoot(), 0);
  }

  private renderSearchResults(containerEl: HTMLElement): void {
    const matches = this.app.vault
      .getAllLoadedFiles()
      .filter(
        (file) => this.shouldShowPath(file) && file.path.toLocaleLowerCase().includes(this.query),
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 200);

    if (matches.length === 0) {
      containerEl.createDiv({
        cls: "ixplorer-profile-modal__model-empty",
        text: "No matching paths",
      });
      return;
    }

    for (const file of matches) {
      this.renderPathRow(containerEl, file, 0);
    }
  }

  private renderFolderChildren(containerEl: HTMLElement, folder: TFolder, depth: number): void {
    const children = folder.children
      .filter((child) => this.shouldShowPath(child))
      .sort((left, right) => {
        const leftFolder = left instanceof TFolder ? 0 : 1;
        const rightFolder = right instanceof TFolder ? 0 : 1;
        return leftFolder - rightFolder || left.name.localeCompare(right.name);
      });

    for (const child of children) {
      this.renderPathRow(containerEl, child, depth);
    }
  }

  private renderPathRow(containerEl: HTMLElement, file: TAbstractFile, depth: number): void {
    const path = normalizePickerPath(file.path);
    const row = containerEl.createDiv({
      cls: "ixplorer-index-path-picker__row",
      attr: { style: `padding-left: ${depth * 1.25}rem` },
    });

    if (file instanceof TFolder) {
      const expandButton = row.createEl("button", {
        cls: "clickable-icon ixplorer-index-path-picker__expand",
        attr: { type: "button", "aria-label": `Toggle ${file.path || "vault root"}` },
      });
      setIcon(expandButton, this.expandedFolders.has(path) ? "chevron-down" : "chevron-right");
      expandButton.addEventListener("click", () => {
        if (this.expandedFolders.has(path)) {
          this.expandedFolders.delete(path);
        } else {
          this.expandedFolders.add(path);
        }
        this.renderTree();
      });
    } else {
      row.createSpan({ cls: "ixplorer-index-path-picker__spacer" });
    }

    const checkbox = row.createEl("input", {
      attr: {
        type: "checkbox",
        "aria-label": `Select ${file.path}`,
      },
    });
    checkbox.checked = this.isSelected(file);
    checkbox.addEventListener("change", () => {
      this.togglePath(file, checkbox.checked);
      this.renderTree();
    });
    row.createSpan({ text: file.path || "/" });

    if (file instanceof TFolder && this.expandedFolders.has(path)) {
      this.renderFolderChildren(containerEl, file, depth + 1);
    }
  }

  private togglePath(file: TAbstractFile, selected: boolean): void {
    const path = normalizePickerPath(file.path);
    if (!selected) {
      const selectedAncestor = this.findSelectedAncestor(path);
      if (selectedAncestor) {
        this.selectedPaths.delete(selectedAncestor);
        const ancestor = this.app.vault.getAbstractFileByPath(selectedAncestor);
        if (ancestor instanceof TFolder) {
          for (const descendantPath of this.collectSupportedFilePaths(ancestor)) {
            if (descendantPath !== path && !descendantPath.startsWith(`${path}/`)) {
              this.selectedPaths.add(descendantPath);
            }
          }
        }
      }
      this.removePathAndDescendants(path);
      return;
    }

    this.removeDescendants(path);
    this.selectedPaths.add(path);
  }

  private isSelected(file: TAbstractFile): boolean {
    const path = normalizePickerPath(file.path);
    return (
      this.selectedPaths.has(path) ||
      Array.from(this.selectedPaths).some((selectedPath) => path.startsWith(`${selectedPath}/`))
    );
  }

  private removePathAndDescendants(path: string): void {
    for (const selectedPath of Array.from(this.selectedPaths)) {
      if (
        selectedPath === path ||
        selectedPath.startsWith(`${path}/`) ||
        path.startsWith(`${selectedPath}/`)
      ) {
        this.selectedPaths.delete(selectedPath);
      }
    }
  }

  private removeDescendants(path: string): void {
    for (const selectedPath of Array.from(this.selectedPaths)) {
      if (selectedPath.startsWith(`${path}/`)) {
        this.selectedPaths.delete(selectedPath);
      }
    }
  }

  private findSelectedAncestor(path: string): string | undefined {
    return Array.from(this.selectedPaths).find(
      (selectedPath) => path !== selectedPath && path.startsWith(`${selectedPath}/`),
    );
  }

  private collectSupportedFilePaths(folder: TFolder): string[] {
    const paths: string[] = [];
    for (const child of folder.children) {
      if (!this.shouldShowPath(child)) {
        continue;
      }

      if (child instanceof TFolder) {
        paths.push(...this.collectSupportedFilePaths(child));
      } else if (child instanceof TFile) {
        paths.push(normalizePickerPath(child.path));
      }
    }
    return paths;
  }

  private shouldShowPath(file: TAbstractFile): boolean {
    if (isHiddenOrIgnoredPath(file.path, this.getIgnoredGlobs())) {
      return false;
    }

    if (file instanceof TFolder) {
      return true;
    }

    return file instanceof TFile && isSupportedIndexFile(file.path);
  }

  private getIgnoredGlobs(): string[] {
    const vaultWithConfig = this.app.vault as typeof this.app.vault & {
      getConfig?(key: string): unknown;
    };
    const value = vaultWithConfig.getConfig?.("userIgnoreFilters");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
}

function hasIndexingConfigChanged(left: IndexProfile, right: IndexProfile): boolean {
  return (
    left.mode !== right.mode ||
    left.embeddingModelProfileId !== right.embeddingModelProfileId ||
    left.chunkSize !== right.chunkSize ||
    left.chunkOverlap !== right.chunkOverlap ||
    left.embeddingBatchSize !== right.embeddingBatchSize ||
    left.pdfChunkSize !== right.pdfChunkSize ||
    left.pdfChunkOverlap !== right.pdfChunkOverlap ||
    left.includeFolders.join("\n") !== right.includeFolders.join("\n") ||
    left.excludeGlobs.join("\n") !== right.excludeGlobs.join("\n")
  );
}

function normalizePickerPath(path: string): string {
  return normalizeVaultPath(path).replace(/\/+$/, "");
}

function isSupportedIndexFile(path: string): boolean {
  const lower = path.toLocaleLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".docx") ||
    lower.endsWith(".epub") ||
    lower.endsWith(".fb2")
  );
}

function isHiddenOrIgnoredPath(path: string, ignoredGlobs: string[]): boolean {
  const normalized = normalizePickerPath(path);
  if (!normalized) {
    return false;
  }

  if (normalized.split("/").some((segment) => segment.startsWith("."))) {
    return true;
  }

  return ignoredGlobs.some((glob) => vaultPathMatchesGlob(normalized, glob));
}

function formatReportTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

interface ServerProfileModalOptions {
  profile?: ServerProfile;
  profiles: ServerProfile[];
  onSave(profile: ServerProfile): Promise<void>;
}

class ServerProfileModal extends Modal {
  private name = this.options.profile?.name ?? "";
  private apiFormat: ApiFormat = this.options.profile?.apiFormat ?? "openai-compatible";
  private baseUrl = this.options.profile?.baseUrl ?? "";
  private apiKey = this.options.profile?.apiKey ?? "";

  constructor(
    app: App,
    private readonly options: ServerProfileModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", {
      text: this.options.profile ? "Edit server profile" : "Add server profile",
    });

    new Setting(contentEl)
      .setName("Name")
      .setDesc("Human-readable name shown in settings and model selectors.")
      .addText((text) =>
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("API format")
      .setDesc("Request and response format used by this provider.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openai-compatible", "OpenAI-compatible")
          .addOption("ollama", "Ollama")
          .addOption("anthropic", "Anthropic")
          .setValue(this.apiFormat)
          .onChange((value) => {
            this.apiFormat = value as ApiFormat;
          }),
      );

    new Setting(contentEl)
      .setName("Base URL")
      .setDesc("Provider endpoint URL, for example an OpenRouter, Ollama, or Anthropic API base.")
      .addText((text) =>
        text.setValue(this.baseUrl).onChange((value) => {
          this.baseUrl = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("API key")
      .setDesc("Optional. Used as a bearer token for providers that require authentication.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.apiKey).onChange((value) => {
          this.apiKey = value.trim();
        });
      });

    renderModalActions(contentEl, {
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    if (!this.name || !this.baseUrl) {
      new Notice("Fill all required fields.");
      return;
    }

    if (hasDuplicateProfileName(this.options.profiles, this.name, this.options.profile?.id)) {
      new Notice("Name must be unique.");
      return;
    }

    const now = new Date().toISOString();
    await this.options.onSave({
      id: this.options.profile?.id ?? createProfileId("server"),
      name: this.name,
      apiFormat: this.apiFormat,
      baseUrl: normalizeUrl(this.baseUrl, ""),
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      isSuspended: this.options.profile?.isSuspended,
      suspendedReason: this.options.profile?.suspendedReason,
      createdAt: this.options.profile?.createdAt ?? now,
      updatedAt: now,
    });
    this.close();
  }
}

type ModelProfile = ChatModelProfile | EmbeddingModelProfile;

interface ModelProfileModalOptions<TProfile extends ModelProfile> {
  kind: "chat" | "embedding";
  profile?: TProfile;
  servers: ServerProfile[];
  profiles: TProfile[];
  fetchedModelsByServerId: Map<string, DiscoveredModel[]>;
  fetchModels(server: ServerProfile): Promise<DiscoveredModel[]>;
  verifyEmbedding?: (server: ServerProfile, modelName: string) => Promise<boolean>;
  onSave(profile: TProfile): Promise<void>;
}

class ModelProfileModal<TProfile extends ModelProfile> extends Modal {
  private name = this.options.profile?.name ?? "";
  private serverProfileId =
    this.options.profile?.serverProfileId ??
    this.options.servers.find((server) => !server.isSuspended)?.id ??
    "";
  private modelName = this.options.profile?.modelName ?? "";
  private temperature =
    this.options.kind === "chat" && this.options.profile && "temperature" in this.options.profile
      ? (this.options.profile.temperature?.toString() ?? "")
      : "";
  private maxTokens =
    this.options.kind === "chat" && this.options.profile && "maxTokens" in this.options.profile
      ? (this.options.profile.maxTokens?.toString() ?? "")
      : "";
  private contextLength =
    this.options.kind === "chat"
      ? (this.options.profile?.capabilities?.contextLength?.toString() ?? "")
      : "";
  private modelInputEl: HTMLInputElement | null = null;
  private modelMenuEl: HTMLElement | null = null;
  private readonly handleDocumentPointerDown = (event: PointerEvent): void => {
    this.closeModelMenuOnOutsidePointer(event);
  };

  constructor(
    app: App,
    private readonly options: ModelProfileModalOptions<TProfile>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", {
      text: this.options.profile
        ? `Edit ${this.options.kind} model profile`
        : `Add ${this.options.kind} model profile`,
    });

    new Setting(contentEl)
      .setName("Name")
      .setDesc("Human-readable name shown in settings and chat controls.")
      .addText((text) =>
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        }),
      );

    new Setting(contentEl)
      .setName("Server")
      .setDesc("Provider endpoint used to call this model.")
      .addDropdown((dropdown) => {
        for (const server of this.options.servers.filter(
          (profile) => profile.isSuspended !== true,
        )) {
          dropdown.addOption(server.id, server.name);
        }
        dropdown.setValue(this.serverProfileId).onChange((value) => {
          this.serverProfileId = value;
          this.modelName = "";
          this.refreshModelControl();
        });
      });

    new Setting(contentEl)
      .setName("Model")
      .setDesc("Model name fetched from the selected server profile.")
      .addText((text) => {
        this.modelInputEl = text.inputEl;
        text
          .setPlaceholder("Fetch models, then type to filter")
          .setValue(this.modelName)
          .onChange((value) => {
            this.modelName = value.trim();
            this.renderModelMenu();
          });
        text.inputEl.addClass("ixplorer-profile-modal__model-input");
        this.modelMenuEl =
          text.inputEl.parentElement?.createDiv({
            cls: "ixplorer-profile-modal__model-menu is-hidden",
            attr: { role: "listbox" },
          }) ?? null;
        text.inputEl.addEventListener("focus", () => this.renderModelMenu());
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            this.closeModelMenu();
          }
        });
        this.refreshModelControl();
      })
      .addButton((button) =>
        button.setButtonText("Fetch").onClick(async () => {
          const server = this.selectedServer();
          if (!server) {
            new Notice("Select a server profile first.");
            return;
          }
          await this.options.fetchModels(server);
          this.refreshModelControl(false);
        }),
      );

    if (this.options.kind === "chat") {
      new Setting(contentEl)
        .setName("Temperature")
        .setDesc("Optional. Controls response randomness; blank uses the provider or app default.")
        .addText((text) =>
          text.setValue(this.temperature).onChange((value) => {
            this.temperature = value.trim();
          }),
        );
      new Setting(contentEl)
        .setName("Max tokens")
        .setDesc(
          "Optional. Limits response length; blank uses provider/model default or 4096 for Anthropic.",
        )
        .addText((text) =>
          text.setValue(this.maxTokens).onChange((value) => {
            this.maxTokens = value.trim();
          }),
        );
      new Setting(contentEl)
        .setName("Context window tokens")
        .setDesc("Optional. Used to block chat submits when the conversation no longer fits.")
        .addText((text) =>
          text.setValue(this.contextLength).onChange((value) => {
            this.contextLength = value.trim();
          }),
        );
    }

    renderModalActions(contentEl, {
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  onClose(): void {
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    this.contentEl.empty();
  }

  private refreshModelControl(showMenu = false): void {
    if (!this.modelInputEl) {
      return;
    }

    const models = this.modelsForSelectedServer();
    if (this.modelName && !models.some((model) => model.name === this.modelName)) {
      this.modelInputEl.value = this.modelName;
      if (showMenu) {
        this.renderModelMenu();
      } else {
        this.closeModelMenu();
      }
      return;
    }

    if (this.options.profile) {
      this.modelName = this.modelName || models[0]?.name || "";
    }
    this.modelInputEl.value = this.modelName;
    if (showMenu) {
      this.renderModelMenu();
    } else {
      this.closeModelMenu();
    }
  }

  private renderModelMenu(): void {
    if (!this.modelMenuEl || !this.modelInputEl) {
      return;
    }

    this.modelMenuEl.empty();
    const query = this.modelInputEl.value.trim().toLocaleLowerCase();
    const models = this.modelsForSelectedServer().filter((model) =>
      model.name.toLocaleLowerCase().includes(query),
    );

    if (models.length === 0) {
      this.modelMenuEl.createDiv({
        cls: "ixplorer-profile-modal__model-empty",
        text: "No matching models",
      });
      this.modelMenuEl.removeClass("is-hidden");
      return;
    }

    for (const model of models) {
      const option = this.modelMenuEl.createEl("button", {
        cls: "ixplorer-profile-modal__model-option",
        text: model.name,
        attr: {
          type: "button",
          role: "option",
          title: model.name,
          "aria-selected": String(this.modelName === model.name),
        },
      });
      option.addEventListener("click", () => {
        this.modelName = model.name;
        this.modelInputEl!.value = model.name;
        this.closeModelMenu();
      });
    }

    this.modelMenuEl.removeClass("is-hidden");
  }

  private closeModelMenu(): void {
    this.modelMenuEl?.addClass("is-hidden");
  }

  private closeModelMenuOnOutsidePointer(event: PointerEvent): void {
    if (!this.modelMenuEl || !this.modelInputEl) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (this.modelInputEl.contains(target) || this.modelMenuEl.contains(target)) {
      return;
    }

    this.closeModelMenu();
  }

  private modelsForSelectedServer(): DiscoveredModel[] {
    return (this.options.fetchedModelsByServerId.get(this.serverProfileId) ?? []).filter((model) =>
      this.options.kind === "chat" ? model.capabilities.chat : model.capabilities.embeddings,
    );
  }

  private selectedServer(): ServerProfile | undefined {
    return this.options.servers.find((server) => server.id === this.serverProfileId);
  }

  private async save(): Promise<void> {
    if (!this.name || !this.serverProfileId || !this.modelName) {
      new Notice("Fill all required fields.");
      return;
    }

    if (hasDuplicateProfileName(this.options.profiles, this.name, this.options.profile?.id)) {
      new Notice("Name must be unique.");
      return;
    }

    const server = this.selectedServer();
    if (!server || server.isSuspended) {
      new Notice("Select an active server profile.");
      return;
    }

    const model = this.modelsForSelectedServer().find(
      (candidate) => candidate.name === this.modelName,
    );
    if (!model && !this.options.profile) {
      new Notice("Fetch models before creating a model profile.");
      return;
    }

    if (this.options.kind === "embedding") {
      const verified = await this.options.verifyEmbedding?.(server, this.modelName);
      if (!verified) {
        new Notice("Embedding capability could not be verified.");
        return;
      }
    }

    const now = new Date().toISOString();
    const baseProfile = {
      id: this.options.profile?.id ?? createProfileId(`${this.options.kind}-model`),
      name: this.name,
      serverProfileId: this.serverProfileId,
      modelName: this.modelName,
      capabilities: this.resolveCapabilities(model),
      isSuspended: this.options.profile?.isSuspended,
      suspendedReason: this.options.profile?.suspendedReason,
      createdAt: this.options.profile?.createdAt ?? now,
      updatedAt: now,
    };

    const profile =
      this.options.kind === "chat"
        ? {
            ...baseProfile,
            temperature: optionalNumber(this.temperature),
            maxTokens: parsePositiveInteger(this.maxTokens) ?? undefined,
          }
        : baseProfile;

    await this.options.onSave(profile as TProfile);
    this.close();
  }

  private resolveCapabilities(model: DiscoveredModel | undefined) {
    const capabilities = model?.capabilities ?? this.options.profile?.capabilities;
    const contextLength =
      this.options.kind === "chat" ? parsePositiveInteger(this.contextLength) : undefined;

    if (!contextLength) {
      return capabilities;
    }

    return {
      ...(capabilities ?? {
        chat: this.options.kind === "chat",
        embeddings: this.options.kind === "embedding",
        detectionSource: "format-default" as const,
      }),
      contextLength,
    };
  }
}

function renderModalActions(
  containerEl: HTMLElement,
  actions: { onCancel(): void; onSave(): void },
): void {
  new Setting(containerEl)
    .setClass("ixplorer-profile-modal__actions")
    .addButton((button) => button.setButtonText("Cancel").onClick(actions.onCancel))
    .addButton((button) => button.setCta().setButtonText("Save").onClick(actions.onSave));
}

function createIconButton(
  containerEl: HTMLElement,
  options: {
    icon: string;
    className?: string;
    label: string;
    disabled?: boolean;
    onClick(): void;
  },
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: ["clickable-icon", "ixplorer-settings__icon-button", options.className]
      .filter(Boolean)
      .join(" "),
    attr: {
      type: "button",
      "aria-label": options.label,
      "aria-disabled": String(options.disabled === true),
      title: options.label,
    },
  });
  button.disabled = options.disabled === true;
  setIcon(button, options.icon);
  if (!button.disabled) {
    button.addEventListener("click", options.onClick);
  }
  return button;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}
