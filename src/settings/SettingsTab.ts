import { App, Modal, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";

import type IxplorerPlugin from "../main";
import { parseNonNegativeInteger, parsePositiveInteger } from "../shared/numbers";
import { ApiFormat } from "../shared/types";
import { renderIndexControl } from "../ui/IndexControl";
import { fetchAvailableModels, verifyEmbeddingCapability, DiscoveredModel } from "./connectionTests";
import { DUCK_DUCK_GO_DESCRIPTION, INDEX_FOLDER_DESCRIPTION } from "./privacyCopy";
import {
  ChatModelProfile,
  EmbeddingModelProfile,
  ServerProfile,
  canDeleteEmbeddingModelProfile,
  canDeleteServerProfile,
  createProfileId,
  formatListInput,
  getActiveIndexProfile,
  hasDuplicateProfileName,
  normalizeListInput,
  normalizeSettingsState,
  normalizeUrl,
  normalizeVaultFolder,
  updateActiveIndexProfile,
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
            verifyEmbedding: (server, modelName) => this.verifyEmbeddingForServer(server, modelName),
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

    const indexControlEl = containerEl.createDiv({ cls: "ixplorer-settings__index-control" });
    const renderCurrentIndexControl = () => {
      renderIndexControl(indexControlEl, {
        state: this.plugin.indexing.getState(),
        actions: {
          start: () => this.plugin.indexing.start(),
          pause: () => this.plugin.indexing.pause(),
          resume: () => this.plugin.indexing.resume(),
          rebuild: () => this.plugin.indexing.rebuild(),
        },
      });
    };
    this.unsubscribeIndexing = this.plugin.indexing.subscribe(renderCurrentIndexControl);
    renderCurrentIndexControl();

    const activeProfile = getActiveIndexProfile(this.plugin.settings);
    new Setting(containerEl).setName("Embedding model").addDropdown((dropdown) => {
      dropdown.addOption("", "Suspended: select embedding model");
      for (const profile of this.plugin.settings.embeddingModelProfiles.filter(
        (candidate) => candidate.isSuspended !== true,
      )) {
        dropdown.addOption(profile.id, profile.name);
      }
      dropdown.setValue(activeProfile.embeddingModelProfileId).onChange(async (value) => {
        updateActiveIndexProfile(this.plugin.settings, { embeddingModelProfileId: value });
        await this.plugin.saveSettings();
        this.plugin.markIndexStale();
        this.display();
      });
    });

    new Setting(containerEl)
      .setName("Index folder")
      .setDesc(INDEX_FOLDER_DESCRIPTION)
      .addText((text) =>
        text.setPlaceholder(".ixplorer/index").setValue(this.plugin.settings.lanceDbFolder).onChange(async (value) => {
          const indexFolder = normalizeVaultFolder(value);
          this.plugin.settings.lanceDbFolder = indexFolder;
          updateActiveIndexProfile(this.plugin.settings, { indexFolder });
          await this.plugin.saveSettings();
          this.plugin.markIndexStale();
        }),
      );

    new Setting(containerEl).setName("Included folders").addTextArea((text) =>
      text.setValue(formatListInput(this.plugin.settings.includeFolders)).onChange(async (value) => {
        const folders = normalizeListInput(value);
        this.plugin.settings.includeFolders =
          folders.length > 0 ? folders : [...this.plugin.defaultSettings.includeFolders];
        updateActiveIndexProfile(this.plugin.settings, {
          includeFolders: this.plugin.settings.includeFolders,
        });
        await this.plugin.saveSettings();
        this.plugin.markIndexStale();
      }),
    );

    this.renderIndexNumberSetting(containerEl, "Chunk size", activeProfile.chunkSize, (value) => {
      updateActiveIndexProfile(this.plugin.settings, { chunkSize: value });
    });
    this.renderIndexNumberSetting(containerEl, "Chunk overlap", activeProfile.chunkOverlap, (value) => {
      updateActiveIndexProfile(this.plugin.settings, { chunkOverlap: value });
    }, true);
    this.renderIndexNumberSetting(
      containerEl,
      "Embedding batch size",
      activeProfile.embeddingBatchSize,
      (value) => updateActiveIndexProfile(this.plugin.settings, { embeddingBatchSize: value }),
    );
    this.renderIndexNumberSetting(containerEl, "PDF chunk size", activeProfile.pdfChunkSize, (value) => {
      updateActiveIndexProfile(this.plugin.settings, { pdfChunkSize: value });
    });
    this.renderIndexNumberSetting(
      containerEl,
      "PDF chunk overlap",
      activeProfile.pdfChunkOverlap,
      (value) => updateActiveIndexProfile(this.plugin.settings, { pdfChunkOverlap: value }),
      true,
    );

    new Setting(containerEl).setName("Excluded globs").addTextArea((text) =>
      text.setValue(formatListInput(this.plugin.settings.excludeGlobs)).onChange(async (value) => {
        const globs = normalizeListInput(value);
        this.plugin.settings.excludeGlobs =
          globs.length > 0 ? globs : [...this.plugin.defaultSettings.excludeGlobs];
        updateActiveIndexProfile(this.plugin.settings, {
          excludeGlobs: this.plugin.settings.excludeGlobs,
        });
        await this.plugin.saveSettings();
        this.plugin.markIndexStale();
      }),
    );
  }

  private renderIndexNumberSetting(
    containerEl: HTMLElement,
    name: string,
    value: number,
    update: (value: number) => void,
    allowZero = false,
  ): void {
    new Setting(containerEl).setName(name).addText((text) =>
      text.setValue(String(value)).onChange(async (rawValue) => {
        const parsed = allowZero ? parseNonNegativeInteger(rawValue) : parsePositiveInteger(rawValue);
        if (parsed === null) {
          return;
        }
        update(parsed);
        await this.plugin.saveSettings();
        this.plugin.markIndexStale();
      }),
    );
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

function statusForProfile(
  profile: { isSuspended?: boolean; suspendedReason?: string },
): ProfileStatus | null {
  if (profile.isSuspended) {
    return {
      kind: "is-suspended",
      label: "Suspended",
      title: profile.suspendedReason ?? "Suspended",
    };
  }

  return null;
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
      ? this.options.profile.temperature?.toString() ?? ""
      : "";
  private maxTokens =
    this.options.kind === "chat" && this.options.profile && "maxTokens" in this.options.profile
      ? this.options.profile.maxTokens?.toString() ?? ""
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
        for (const server of this.options.servers.filter((profile) => profile.isSuspended !== true)) {
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
        this.modelMenuEl = text.inputEl.parentElement?.createDiv({
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
        .setDesc("Optional. Limits response length; blank uses provider/model default or 4096 for Anthropic.")
        .addText((text) =>
          text.setValue(this.maxTokens).onChange((value) => {
            this.maxTokens = value.trim();
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

    const model = this.modelsForSelectedServer().find((candidate) => candidate.name === this.modelName);
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
      capabilities: model?.capabilities ?? this.options.profile?.capabilities,
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
