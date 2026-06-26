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
import { ChatModelClient } from "../../../adapters/model-provider/chat/ChatModelClient";
import {
  isResponsesCapabilityCurrent,
  probeResponsesCapabilities,
} from "../../../adapters/settings/responsesCapabilityProbe";
import { startChatProfileProbes as startChatProfileProbeTasks } from "../../../adapters/settings/chatProfileProbes";
import { IndexingState, IndexSourceReportItem } from "../../../adapters/indexing/IndexingService";
import { IndexProfile } from "../../../adapters/indexing/FileVectorIndexStore";
import { formatIndexSize } from "../../../adapters/indexing/indexSize";
import { parseNonNegativeInteger, parsePositiveInteger } from "../../../shared/numbers";
import { normalizeVaultPath, vaultPathMatchesGlob } from "../../../shared/pathFilters";
import { ApiFormat } from "../../../core/agent/protocol";
import {
  fetchAvailableModels,
  fetchModelContextLength,
  verifyEmbeddingCapability,
  DiscoveredModel,
} from "../../../adapters/settings/connectionTests";
import { contextLengthInputAfterDiscovery } from "../../../adapters/settings/modelContext";
import { probeToolControlCapabilities, ToolCapabilityProbeResult } from "../../../adapters/settings/toolCapabilityProbe";
import {
  createToolCapabilitySettings,
  resolveToolCapabilities,
  ToolCapabilitySettings,
} from "../../../adapters/settings/toolCapabilities";
import { DUCK_DUCK_GO_DESCRIPTION } from "../../../adapters/settings/privacyCopy";
import {
  capabilityCacheKey,
  ModelCapabilitySnapshot,
  unknownSnapshot,
} from "../../../adapters/settings/modelCapabilityCache";
import { probeReasoningVisibility } from "../../../adapters/settings/reasoningVisibilityProbe";
import {
  ChatModelProfile,
  DEFAULT_INDEX_PROFILE,
  EmbeddingModelProfile,
  ServerProfile,
  MAX_INDEX_PROFILE_COUNT,
  MAX_PROFILE_NAME_LENGTH,
  canDeleteEmbeddingModelProfile,
  canDeleteServerProfile,
  createIndexProfile,
  createProfileId,
  getActiveIndexProfile,
  hasDuplicateProfileName,
  isValidIndexProfileName,
  isValidProfileName,
  normalizeSettingsState,
  normalizeUrl,
} from "../../../adapters/settings/settings";

export class IxplorerSettingTab extends PluginSettingTab {
  private unsubscribeIndexing: (() => void) | null = null;
  private readonly fetchedModelsByServerId = new Map<string, DiscoveredModel[]>();
  private metadataRefreshStarted = false;

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

    renderCategoryHeading(containerEl, "Ixplorer");
    this.renderDebugSettings(containerEl);
    this.renderSearchEngineSettings(containerEl);
    this.renderProfileSettings(containerEl);
    this.renderIndexingSettings(containerEl);
    if (!this.metadataRefreshStarted) {
      this.metadataRefreshStarted = true;
      void this.refreshMetadataCapabilities();
    }
  }

  private async refreshMetadataCapabilities(): Promise<void> {
    let changed = false;
    for (const server of this.plugin.settings.serverProfiles.filter(
      (candidate) => candidate.isSuspended !== true,
    )) {
      const identity = `${server.baseUrl}|${server.updatedAt}`;
      const result = await fetchAvailableModels(server, { logger: this.plugin.logger });
      const currentServer = this.plugin.settings.serverProfiles.find(
        (candidate) => candidate.id === server.id,
      );
      if (!currentServer || `${currentServer.baseUrl}|${currentServer.updatedAt}` !== identity) {
        continue;
      }
      this.fetchedModelsByServerId.set(server.id, result.models);
      for (const model of result.models) {
        if (!model.capabilitySnapshot) continue;
        for (const protocol of ["chat-completions", "responses"] as const) {
          const key = capabilityCacheKey({
            baseUrl: server.baseUrl,
            apiKey: server.apiKey,
            model: model.id,
            protocol,
          });
          this.plugin.settings.modelCapabilityCache[key] = model.capabilitySnapshot;
          changed = true;
        }
      }
    }
    if (changed) await this.plugin.saveSettings();
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
        fetchModels: (server) => this.fetchModelsForServer(server),
        fetchContextLength: (server, modelName) =>
          this.fetchContextLengthForModel(server, modelName),
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
            fetchContextLength: (server, modelName) =>
              this.fetchContextLengthForModel(server, modelName),
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
              await this.refreshMetadataCapabilities();
              this.startChatProfileProbes(profile.id);
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
        fetchModels: (server) => this.fetchModelsForServer(server),
        onSave: async (profile) => {
          this.plugin.settings.embeddingModelProfiles.push(profile);
          await this.plugin.saveSettings();
          this.display();
          this.startEmbeddingProfileProbe(profile.id);
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
            fetchModels: (server) => this.fetchModelsForServer(server),
            onSave: async (updatedProfile) => {
              Object.assign(profile, updatedProfile, { updatedAt: new Date().toISOString() });
              await this.plugin.saveSettings();
              this.display();
              this.startEmbeddingProfileProbe(updatedProfile.id);
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

  private startEmbeddingProfileProbe(profileId: string): void {
    const savedProfile = this.plugin.settings.embeddingModelProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (!savedProfile) return;
    const server = this.plugin.settings.serverProfiles.find(
      (profile) => profile.id === savedProfile.serverProfileId && profile.isSuspended !== true,
    );
    if (!server) return;
    const target = {
      profileId,
      serverProfileId: savedProfile.serverProfileId,
      modelName: savedProfile.modelName,
    };
    void this.verifyEmbeddingForServer(server, target.modelName)
      .then(async (verified) => {
        const profile = this.plugin.settings.embeddingModelProfiles.find(
          (candidate) =>
            candidate.id === target.profileId &&
            candidate.serverProfileId === target.serverProfileId &&
            candidate.modelName === target.modelName,
        );
        if (!profile) return;
        profile.capabilities ??= {
          chat: false,
          embeddings: verified,
          detectionSource: "probe",
        };
        profile.capabilities.embeddings = verified;
        profile.capabilities.detectionSource = "probe";
        if (verified) {
          if (profile.suspendedReason === "Embedding capability could not be verified.") {
            profile.isSuspended = false;
            profile.suspendedReason = undefined;
          }
        } else {
          profile.isSuspended = true;
          profile.suspendedReason = "Embedding capability could not be verified.";
        }
        profile.updatedAt = new Date().toISOString();
        await this.plugin.saveSettings();
        this.display();
      })
      .catch(() => new Notice(`Capability detection failed for ${savedProfile.name}.`));
  }

  private async probeToolsForServer(
    server: ServerProfile,
    modelName: string,
  ): Promise<ToolCapabilityProbeResult> {
    return probeToolControlCapabilities({
      provider: new ChatModelClient({
        apiFormat: server.apiFormat,
        baseUrl: server.baseUrl,
        apiKey: server.apiKey,
        logger: this.plugin.logger,
      }),
      model: modelName,
      apiFormat: server.apiFormat,
    });
  }

  private startChatProfileProbes(profileId: string): void {
    const savedProfile = this.plugin.settings.chatModelProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (!savedProfile) return;
    const server = this.plugin.settings.serverProfiles.find(
      (profile) => profile.id === savedProfile.serverProfileId && profile.isSuspended !== true,
    );
    if (!server) return;
    const target = {
      profileId,
      serverProfileId: savedProfile.serverProfileId,
      modelName: savedProfile.modelName,
    };
    const shouldProbeResponses =
      server.apiFormat === "openai-compatible" &&
      savedProfile.reasoning.mode !== "off" &&
      !isResponsesCapabilityCurrent(
        savedProfile.reasoningCapabilities,
        server,
        savedProfile.modelName,
      );

    startChatProfileProbeTasks({
      probeTools: () => this.probeToolsForServer(server, target.modelName),
      probeReasoning: () =>
        probeReasoningVisibility({
          provider: new ChatModelClient({
            apiFormat: server.apiFormat,
            baseUrl: server.baseUrl,
            apiKey: server.apiKey,
            logger: this.plugin.logger,
          }),
          model: target.modelName,
        }),
      probeResponses: shouldProbeResponses
        ? () =>
          probeResponsesCapabilities({
            server,
            model: target.modelName,
            efforts: savedProfile.reasoningCapabilities?.efforts ?? [],
            logger: this.plugin.logger,
          })
        : undefined,
      onTools: async (probe) => {
        let saved: unknown;
        await this.updateChatProfileAfterProbe(target, (profile) => {
          profile.capabilities ??= {
            chat: true,
            embeddings: false,
            detectionSource: "probe",
          };
          const { probeAuditData, ...capabilityLayer } = probe;
          const probeAudit = {
            ranAt: probeAuditData.ranAt,
            modelName: target.modelName,
            apiFormat: server.apiFormat,
            results: probeAuditData.results,
            rawCapabilities: {
              calls: capabilityLayer.calls,
              choiceRequired: capabilityLayer.choiceRequired,
              choiceSpecific: capabilityLayer.choiceSpecific,
              parallelCalls: capabilityLayer.parallelCalls,
            },
          };
          profile.capabilities.toolCalling = {
            formatDefault: {
              ...(profile.capabilities.toolCalling?.formatDefault ??
                createToolCapabilitySettings(false).formatDefault),
            },
            probe: capabilityLayer,
            probeAudit,
          };
          profile.capabilities.tools = probe.calls;
          saved = {
            tools: profile.capabilities.tools,
            toolCalling: profile.capabilities.toolCalling,
          };
        });
        this.plugin.logger.logProbeResult({
          probe: "tool-capabilities",
          profileId: target.profileId,
          model: target.modelName,
          received: probe,
          saved,
        });
      },
      onResponses: async (reasoningCapabilities) => {
        await this.updateChatProfileAfterProbe(target, (profile) => {
          profile.reasoningCapabilities = reasoningCapabilities;
          profile.reasoning.summary = reasoningCapabilities.summary ? "auto" : "off";
          if (!profile.reasoning.effort && reasoningCapabilities.defaultEffort) {
            profile.reasoning.effort = reasoningCapabilities.defaultEffort;
          }
        });
        this.plugin.logger.logProbeResult({
          probe: "responses-capabilities",
          profileId: target.profileId,
          model: target.modelName,
          received: reasoningCapabilities,
          saved: reasoningCapabilities,
        });
      },
      onReasoning: async (result) => {
        const currentProfile = this.plugin.settings.chatModelProfiles.find(
          (candidate) =>
            candidate.id === target.profileId &&
            candidate.serverProfileId === target.serverProfileId &&
            candidate.modelName === target.modelName,
        );
        if (!currentProfile) return;
        const identity = {
          baseUrl: server.baseUrl,
          apiKey: server.apiKey,
          model: target.modelName,
          protocol: "chat-completions" as const,
        };
        const key = capabilityCacheKey(identity);
        const current =
          this.plugin.settings.modelCapabilityCache[key] ?? unknownSnapshot(result.checkedAt);
        const snapshot: ModelCapabilitySnapshot = {
          ...current,
          reasoning: {
            ...current.reasoning,
            visibleOutput: result.visible ? "supported" : "unsupported",
          },
          source: "probe",
          checkedAt: result.checkedAt,
          expiresAt: result.expiresAt,
        };
        this.plugin.settings.modelCapabilityCache[key] = snapshot;
        await this.plugin.saveSettings();
        this.plugin.logger.logProbeResult({
          probe: "reasoning-visibility",
          profileId: target.profileId,
          model: target.modelName,
          received: result,
          saved: { cacheKey: key, snapshot },
        });
        this.display();
      },
      onError: () => new Notice(`Capability detection failed for ${savedProfile.name}.`),
    });
  }

  private async updateChatProfileAfterProbe(
    target: { profileId: string; serverProfileId: string; modelName: string },
    update: (profile: ChatModelProfile) => void,
  ): Promise<void> {
    const profile = this.plugin.settings.chatModelProfiles.find(
      (candidate) =>
        candidate.id === target.profileId &&
        candidate.serverProfileId === target.serverProfileId &&
        candidate.modelName === target.modelName,
    );
    if (!profile) return;
    update(profile);
    profile.updatedAt = new Date().toISOString();
    await this.plugin.saveSettings();
    this.display();
  }

  private async fetchContextLengthForModel(
    server: ServerProfile,
    modelName: string,
  ): Promise<number | undefined> {
    return fetchModelContextLength(server, modelName, { logger: this.plugin.logger });
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

interface ProfileStatus {
  kind: "is-default" | "is-suspended";
  label: string;
  title: string;
}

function renderCategoryHeading(containerEl: HTMLElement, name: string, description?: string): void {
  const setting = new Setting(containerEl).setName(name).setHeading();

  if (description) {
    setting.setDesc(description);
  }

  setting.settingEl.addClass("ixplorer-settings__category-heading");
}

function renderSubcategoryHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl)
    .setName(name)
    .setHeading()
    .settingEl.addClass("ixplorer-settings__subcategory-heading");
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
  defaultEmbeddingModelProfileId?: string;
  onSave(profile: IndexProfile): Promise<void>;
}

class IndexProfileModal extends Modal {
  private name = this.options.profile?.name ?? "";
  private mode: IndexProfile["mode"] = this.options.profile?.mode ?? "wholeVault";
  private includeFolders = [...(this.options.profile?.includeFolders ?? [])];
  private excludeGlobs = [...(this.options.profile?.excludeGlobs ?? [])];
  private embeddingModelProfileId =
    this.options.profile?.embeddingModelProfileId ??
    this.resolveDefaultEmbeddingModelProfileId() ??
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

  private resolveDefaultEmbeddingModelProfileId(): string | undefined {
    const defaultId = this.options.defaultEmbeddingModelProfileId;
    if (
      defaultId &&
      this.options.embeddingModels.some(
        (profile) => profile.id === defaultId && profile.isSuspended !== true,
      )
    ) {
      return defaultId;
    }

    return this.options.embeddingModels.find((profile) => profile.isSuspended !== true)?.id;
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
      .setDesc(
        `Unique index name shown in settings, chat, and search selectors. Max ${MAX_PROFILE_NAME_LENGTH} characters.`,
      )
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

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
      .setDesc(
        `Human-readable name shown in settings and model selectors. Max ${MAX_PROFILE_NAME_LENGTH} characters.`,
      )
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

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

    if (!isValidProfileName(this.name)) {
      new Notice(`Name must be 1-${MAX_PROFILE_NAME_LENGTH} characters.`);
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
  fetchContextLength?: (server: ServerProfile, modelName: string) => Promise<number | undefined>;
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
  private toolsEnabled =
    this.options.kind === "chat" && this.options.profile && "toolsEnabled" in this.options.profile
      ? this.options.profile.toolsEnabled
      : true;
  private reasoningMode =
    this.options.kind === "chat" && this.options.profile && "reasoning" in this.options.profile
      ? this.options.profile.reasoning.mode
      : "auto";
  private reasoningEffort =
    this.options.kind === "chat" && this.options.profile && "reasoning" in this.options.profile
      ? (this.options.profile.reasoning.effort ?? "")
      : "";
  private reasoningSummary: "off" | "auto" =
    this.options.kind === "chat" && this.options.profile && "reasoning" in this.options.profile
      ? this.options.profile.reasoning.summary
      : "off";
  private reasoningCapabilities =
    this.options.kind === "chat" &&
      this.options.profile &&
      "reasoningCapabilities" in this.options.profile
      ? this.options.profile.reasoningCapabilities
      : undefined;
  private contextLength =
    this.options.kind === "chat"
      ? (this.options.profile?.capabilities?.contextLength?.toString() ?? "")
      : "";
  private contextLengthInputEl: HTMLInputElement | null = null;
  private capabilityChat = this.options.profile?.capabilities?.chat ?? this.options.kind === "chat";
  private capabilityEmbeddings =
    this.options.profile?.capabilities?.embeddings ?? this.options.kind === "embedding";
  private capabilityVision = this.options.profile?.capabilities?.vision ?? false;
  private capabilityTools = this.options.profile?.capabilities?.toolCalling
    ? resolveToolCapabilities(this.options.profile.capabilities.toolCalling).capabilities.calls
    : (this.options.profile?.capabilities?.tools ?? false);
  private toolCapabilitySettings: ToolCapabilitySettings =
    this.options.profile?.capabilities?.toolCalling ?? createToolCapabilitySettings(false);
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
      .setDesc(
        `Human-readable name shown in settings and chat controls. Max ${MAX_PROFILE_NAME_LENGTH} characters.`,
      )
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

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
          this.reasoningCapabilities = undefined;
          this.toolCapabilitySettings = createToolCapabilitySettings(false);
          this.capabilityTools = false;
          if (this.selectedServer()?.apiFormat !== "openai-compatible") {
            this.reasoningMode = "off";
          } else {
            this.reasoningMode = "auto";
          }
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
            const nextModelName = value.trim();
            if (nextModelName !== this.modelName) {
              this.reasoningCapabilities = undefined;
              this.toolCapabilitySettings = createToolCapabilitySettings(false);
              this.capabilityTools = false;
            }
            this.modelName = nextModelName;
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

    if (this.options.kind === "embedding") {
      this.renderEmbeddingCapabilityControls(contentEl);
    }

    if (this.options.kind === "chat") {
      this.renderToolsControl(contentEl);
      this.renderReasoningControls(contentEl);
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
        .setName("Context size")
        .setDesc(
          "Optional token limit. Filled from model metadata when available and used to enforce the chat context window.",
        )
        .addText((text) => {
          this.contextLengthInputEl = text.inputEl;
          text.setValue(this.contextLength).onChange((value) => {
            this.contextLength = value.trim();
          });
        });
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
        if (this.modelName !== model.name) {
          this.reasoningCapabilities = undefined;
          this.toolCapabilitySettings = createToolCapabilitySettings(false);
          this.capabilityTools = false;
        }
        this.modelName = model.name;
        this.modelInputEl!.value = model.name;
        this.closeModelMenu();
        void this.populateContextLength(model);
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

  private async populateContextLength(model: DiscoveredModel): Promise<void> {
    if (this.options.kind !== "chat") {
      return;
    }

    const selectedServerId = this.serverProfileId;
    let discoveredValue = model.capabilities.contextLength;
    if (discoveredValue === undefined) {
      const server = this.selectedServer();
      if (server) {
        discoveredValue = await this.options.fetchContextLength?.(server, model.name);
      }
    }

    if (this.serverProfileId !== selectedServerId || this.modelName !== model.name) {
      return;
    }

    if (discoveredValue !== undefined) {
      model.capabilities.contextLength = discoveredValue;
      model.capabilities.detectionSource = "metadata";
    }
    this.contextLength = contextLengthInputAfterDiscovery(this.contextLength, discoveredValue);
    if (this.contextLengthInputEl) {
      this.contextLengthInputEl.value = this.contextLength;
    }
  }

  private async save(): Promise<void> {
    if (!this.name || !this.serverProfileId || !this.modelName) {
      new Notice("Fill all required fields.");
      return;
    }

    if (!isValidProfileName(this.name)) {
      new Notice(`Name must be 1-${MAX_PROFILE_NAME_LENGTH} characters.`);
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

    if (this.options.kind === "chat") {
      const allowedEfforts = this.reasoningCapabilities?.efforts;
      if (
        this.reasoningEffort &&
        allowedEfforts &&
        !allowedEfforts.includes(this.reasoningEffort)
      ) {
        new Notice("Reasoning effort must be provider-default or capability-verified.");
        return;
      }
      if (this.reasoningSummary === "auto" && this.reasoningCapabilities?.summary === false) {
        new Notice("Reasoning summaries were not verified for this profile.");
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
          toolsEnabled: this.toolsEnabled,
          noteMutationAccess: this.toolsEnabled,
          reasoning: {
            mode: this.reasoningMode,
            ...(this.reasoningEffort ? { effort: this.reasoningEffort } : {}),
            summary: this.reasoningSummary,
          },
          reasoningCapabilities: this.reasoningCapabilities,
          temperature: optionalNumber(this.temperature),
          maxTokens: parsePositiveInteger(this.maxTokens) ?? undefined,
        }
        : baseProfile;

    await this.options.onSave(profile as TProfile);
    this.close();
  }

  private resolveCapabilities(model: DiscoveredModel | undefined) {
    const contextLength =
      this.options.kind === "chat" ? parsePositiveInteger(this.contextLength) : undefined;

    return {
      chat: this.capabilityChat,
      embeddings: this.capabilityEmbeddings,
      vision: this.capabilityVision,
      tools: this.capabilityTools,
      toolCalling: this.toolCapabilitySettings,
      temperature:
        model?.capabilities.temperature ?? this.options.profile?.capabilities?.temperature,
      maxTokens: model?.capabilities.maxTokens ?? this.options.profile?.capabilities?.maxTokens,
      contextLength,
      maxOutputTokens:
        model?.capabilities.maxOutputTokens ?? this.options.profile?.capabilities?.maxOutputTokens,
      detectionSource:
        model?.capabilities.detectionSource ??
        this.options.profile?.capabilities?.detectionSource ??
        ("format-default" as const),
    };
  }

  private renderEmbeddingCapabilityControls(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Chat")
      .setDesc(
        "The model can answer chat requests. Capabilities are set manually for this profile.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.capabilityChat).onChange((value) => {
          this.capabilityChat = value;
        }),
      );

    new Setting(containerEl)
      .setName("Embeddings")
      .setDesc("The model can create embeddings.")
      .addToggle((toggle) =>
        toggle.setValue(this.capabilityEmbeddings).onChange((value) => {
          this.capabilityEmbeddings = value;
        }),
      );

    new Setting(containerEl)
      .setName("Vision")
      .setDesc("The model accepts image inputs.")
      .addToggle((toggle) =>
        toggle.setValue(this.capabilityVision).onChange((value) => {
          this.capabilityVision = value;
        }),
      );
  }

  private renderReasoningControls(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Reasoning")
      .setDesc(
        "Reasoning output is detected for any compatible stream. Verified Responses support enables native continuation and controls.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("off", "Off")
          .addOption("auto", "Auto")
          .addOption("on", "On")
          .setValue(this.reasoningMode)
          .onChange((value) => {
            this.reasoningMode = value as "off" | "auto" | "on";
          }),
      );
    const effortValues = new Set(this.reasoningCapabilities?.efforts ?? []);
    if (this.reasoningEffort) effortValues.add(this.reasoningEffort);
    new Setting(containerEl)
      .setName("Reasoning effort")
      .setDesc("Auto uses the provider default or a required detected value.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Auto");
        for (const effort of effortValues) dropdown.addOption(effort, effort);
        dropdown.setValue(this.reasoningEffort).onChange((value) => {
          this.reasoningEffort = value;
        });
      });
  }

  private renderToolsControl(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Tools")
      .setDesc("Allow this profile to use tools when support is detected in the background.")
      .addToggle((toggle) =>
        toggle.setValue(this.toolsEnabled).onChange((value) => {
          this.toolsEnabled = value;
        }),
      );
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
