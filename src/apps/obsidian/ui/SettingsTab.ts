import { App, Notice, PluginSettingTab, Setting } from "obsidian";

import type IxplorerPlugin from "../main";
import { IndexProfile } from "../../../adapters/indexing/FileVectorIndexStore";
import { formatIndexSize } from "../../../adapters/indexing/indexSize";
import { DiscoveredModel } from "../../../adapters/settings/connectionTests";
import { MAX_INDEX_PROFILE_COUNT } from "../../../adapters/settings/constants";
import { normalizeSettingsState } from "../../../adapters/settings/normalization";
import { DUCK_DUCK_GO_DESCRIPTION } from "../../../adapters/settings/privacyCopy";
import {
  canDeleteEmbeddingModelProfile,
  canDeleteServerProfile,
  getActiveIndexProfile,
} from "../../../adapters/settings/profileQueries";
import { SettingsCapabilityProber } from "./settings/SettingsCapabilityProber";
import { IndexReportModal } from "./settings/IndexReportModal";
import { IndexProfileModal } from "./settings/IndexProfileModal";
import { ServerProfileModal } from "./settings/ServerProfileModal";
import { ModelProfileModal } from "./settings/ModelProfileModal";
import {
  ProfileStatus,
  createIconButton,
  formatIndexRowProgress,
  renderCategoryHeading,
  renderSubcategoryHeading,
  statusForProfile,
} from "./settings/shared";

export class IxplorerSettingTab extends PluginSettingTab {
  private unsubscribeIndexing: (() => void) | null = null;
  private readonly fetchedModelsByServerId = new Map<string, DiscoveredModel[]>();
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
    normalizeSettingsState(this.plugin.settings);
    containerEl.empty();
    containerEl.addClass("ixplorer-settings");

    renderCategoryHeading(containerEl, "Ixplorer");
    this.renderDebugSettings(containerEl);
    this.renderSearchEngineSettings(containerEl);
    this.renderProfileSettings(containerEl);
    this.renderIndexingSettings(containerEl);
    if (!this.metadataRefreshStarted) {
      this.metadataRefreshStarted = true;
      void this.prober.refreshMetadataCapabilities();
    }
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

  private renderSearchEngineSettings(containerEl: HTMLElement): void {
    renderCategoryHeading(
      containerEl,
      "Search engine",
      "Controls how Ixplorer finds local, graph, index, document, and web evidence before answering.",
    );

    renderSubcategoryHeading(containerEl, "Execution strategy");

    new Setting(containerEl)
      .setName("Force eager research mode")
      .setDesc(
        "Force the existing eager research pipeline for every model. Disable this to permit automatic strategy selection when agentic research becomes available.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.forceEagerResearch).onChange(async (value) => {
          this.plugin.settings.forceEagerResearch = value;
          await this.plugin.saveSettings();
        }),
      );

    renderSubcategoryHeading(containerEl, "Local context");

    new Setting(containerEl)
      .setName("Include active file as context")
      .setDesc("Automatically include the currently open supported file as explicit chat context.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeActiveFileContext).onChange(async (value) => {
          this.plugin.settings.includeActiveFileContext = value;
          await this.plugin.saveSettings();
        }),
      );

    renderSubcategoryHeading(containerEl, "Obsidian graph");

    new Setting(containerEl)
      .setName("Use linked notes")
      .setDesc(
        "Discover linked notes from @mentions, active files, and included attachments before retrieval.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useLinkedNotes).onChange(async (value) => {
          this.plugin.settings.useLinkedNotes = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Include backlinks")
      .setDesc(
        "Use one-hop backlinks as graph candidates. Backlink notes are not traversed further.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.includeBacklinks).onChange(async (value) => {
          this.plugin.settings.includeBacklinks = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Expand filtered files through links")
      .setDesc("When attached files are in Filter mode, also search their linked graph neighbors.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expandFilteredContextThroughLinks)
          .onChange(async (value) => {
            this.plugin.settings.expandFilteredContextThroughLinks = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Graph depth")
      .setDesc(
        "Depth 1 follows direct links, embeds, and backlinks. Depth 2 is reserved for advanced debugging.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("1", "1")
          .addOption("2", "2")
          .setValue(String(this.plugin.settings.graphContextDepth))
          .onChange(async (value) => {
            this.plugin.settings.graphContextDepth = value === "2" ? 2 : 1;
            await this.plugin.saveSettings();
          }),
      );

    this.renderWebSearchSettings(containerEl);
  }

  private renderProfileSettings(containerEl: HTMLElement): void {
    renderCategoryHeading(
      containerEl,
      "Model profiles",
      "Configure provider endpoints and the chat or embedding models that use them.",
    );

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
        fetchModels: (server) => this.prober.fetchModelsForServer(server),
        fetchContextLength: (server, modelName) =>
          this.prober.fetchContextLengthForModel(server, modelName),
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
            fetchModels: (server) => this.prober.fetchModelsForServer(server),
            fetchContextLength: (server, modelName) =>
              this.prober.fetchContextLengthForModel(server, modelName),
            onSave: async (updatedProfile) => {
              Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
              await this.plugin.saveSettings();
              this.display();
            },
          }).open();
        },
        extraActions: [
          {
            icon: "refresh-cw",
            className: "ixplorer-settings__refresh-capabilities-action",
            label: "Refresh capabilities",
            onClick: async () => {
              await this.prober.refreshMetadataCapabilities();
              this.prober.startChatProfileProbes(profile.id);
              new Notice(`Refreshing capabilities for ${profile.name}.`);
            },
          },
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
        fetchModels: (server) => this.prober.fetchModelsForServer(server),
        onSave: async (profile) => {
          this.plugin.settings.embeddingModelProfiles.push(profile);
          await this.plugin.saveSettings();
          this.display();
          this.prober.startEmbeddingProfileProbe(profile.id);
        },
      }).open();
    });

    for (const profile of this.plugin.settings.embeddingModelProfiles) {
      this.renderProfileListItem(listEl, {
        name: profile.name,
        status:
          this.plugin.settings.activeEmbeddingModelProfileId === profile.id && !profile.isSuspended
            ? { kind: "is-default", label: "Default", title: "Default embedding model" }
            : statusForProfile(profile),
        extraActions: [
          {
            icon: "star",
            className: "ixplorer-settings__default-action",
            label:
              this.plugin.settings.activeEmbeddingModelProfileId === profile.id
                ? "Default model"
                : "Set as default model",
            hidden: this.plugin.settings.activeEmbeddingModelProfileId === profile.id,
            disabled:
              profile.isSuspended === true ||
              this.plugin.settings.activeEmbeddingModelProfileId === profile.id,
            onClick: async () => {
              this.plugin.settings.activeEmbeddingModelProfileId = profile.id;
              await this.plugin.saveSettings();
              this.display();
            },
          },
        ],
        onEdit: () => {
          new ModelProfileModal(this.app, {
            kind: "embedding",
            profile,
            servers: this.plugin.settings.serverProfiles,
            profiles: this.plugin.settings.embeddingModelProfiles,
            fetchedModelsByServerId: this.fetchedModelsByServerId,
            fetchModels: (server) => this.prober.fetchModelsForServer(server),
            onSave: async (updatedProfile) => {
              Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
              await this.plugin.saveSettings();
              this.display();
              this.prober.startEmbeddingProfileProbe(updatedProfile.id);
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
        text: `${formatIndexSize(state.indexSizeBytes ?? profile.indexSizeBytes ?? 0)} · ${state.indexedFiles || profile.indexedFileCount || 0
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
          icon: profile.lastIndexedAt ? "history" : "play",
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

  private async openIndexReportModal(profile: IndexProfile): Promise<void> {
    try {
      const report = await this.plugin.loadIndexReport(profile.id);
      new IndexReportModal(this.app, { profile, report }).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "Could not load index report.");
    }
  }

  private renderWebSearchSettings(containerEl: HTMLElement): void {
    renderSubcategoryHeading(containerEl, "Web");

    new Setting(containerEl)
      .setName("DuckDuckGo")
      .setDesc(DUCK_DUCK_GO_DESCRIPTION)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.duckDuckGoEnabled).onChange(async (value) => {
          this.plugin.settings.duckDuckGoEnabled = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Links returned per web search")
      .setDesc(
        "How many result links each DuckDuckGo query returns. Higher values give deep research more sources but cost more requests.",
      )
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.inputEl.max = "50";
        text.setValue(String(this.plugin.settings.duckDuckGoResultLimit));
        text.onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isInteger(parsed)) {
            return;
          }
          this.plugin.settings.duckDuckGoResultLimit = Math.max(1, Math.min(50, parsed));
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Use web for freshness questions")
      .setDesc(
        "Give web evidence more budget when a question asks for current, latest, price, or release information.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.useWebWhenFreshnessNeeded).onChange(async (value) => {
          this.plugin.settings.useWebWhenFreshnessNeeded = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
