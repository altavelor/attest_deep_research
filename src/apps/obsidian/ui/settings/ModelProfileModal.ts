import { App, Modal, Notice, Setting } from "obsidian";

import { DiscoveredModel } from "@adapters/settings";
import { contextLengthInputAfterDiscovery } from "@adapters/settings";
import {
  advertisedToolCapabilities,
  createToolCapabilitySettings,
  ToolCapabilitySettings,
} from "@adapters/settings";
import { MAX_PROFILE_NAME_LENGTH } from "@adapters/settings";
import { ChatModelProfile, EmbeddingModelProfile, ServerProfile } from "@adapters/settings";
import { createProfileId, hasDuplicateProfileName, isValidProfileName } from "@adapters/settings";
import { CapabilityVerificationState, reasoningVerified, toolsVerified } from "@adapters/settings";
import { reasoningCapabilitiesFromSnapshot } from "@adapters/settings";
import { parsePositiveInteger } from "@shared";
import type { MessageKey, Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { optionalNumber, renderModalActions } from "./shared";
import {
  ModelProfileCapabilityControlsOptions,
  renderModelProfileCapabilityControls,
  renderModelProfileToolsControl,
} from "./ModelProfileCapabilityControls";

type ModelProfile = ChatModelProfile | EmbeddingModelProfile;

const TITLE_MESSAGE_KEYS: Record<"edit" | "add", Record<"chat" | "embedding", MessageKey>> = {
  edit: {
    chat: "settings.modelProfileModal.editTitle.chat",
    embedding: "settings.modelProfileModal.editTitle.embedding",
  },
  add: {
    chat: "settings.modelProfileModal.addTitle.chat",
    embedding: "settings.modelProfileModal.addTitle.embedding",
  },
};

export interface ModelProfileModalOptions<TProfile extends ModelProfile> {
  t: Translate;
  getDirection?: () => TextDirection;
  kind: "chat" | "embedding";
  profile?: TProfile;
  servers: ServerProfile[];
  profiles: TProfile[];
  fetchedModelsByServerId: Map<string, DiscoveredModel[]>;
  fetchModels: (server: ServerProfile) => Promise<DiscoveredModel[]>;
  fetchContextLength?: (server: ServerProfile, modelName: string) => Promise<number | undefined>;
  onSave: (profile: TProfile) => Promise<void>;
  onTest?: (profile: TProfile) => Promise<void>;
  getCapabilityStatus?: (profileId: string) => CapabilityVerificationState;
  subscribeCapabilityStatus?: (listener: () => void) => () => void;
  resolveProfile?: (profileId: string) => TProfile | undefined;
}

export class ModelProfileModal<TProfile extends ModelProfile> extends Modal {
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
  private noteMutationAccess =
    this.options.kind === "chat" &&
    this.options.profile &&
    "noteMutationAccess" in this.options.profile
      ? this.options.profile.noteMutationAccess
      : true;
  private reasoningMode: "off" | "on" | "auto" =
    this.options.kind === "chat" && this.options.profile && "reasoning" in this.options.profile
      ? this.options.profile.reasoning.mode === "off"
        ? "off"
        : "on"
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
  private toolCapabilitySettings: ToolCapabilitySettings =
    this.options.profile?.capabilities?.toolCalling ?? createToolCapabilitySettings(false);
  private modelInputEl: HTMLInputElement | null = null;
  private modelMenuEl: HTMLElement | null = null;
  private agentVerifiedSeen = reasoningVerified(this.reasoningCapabilities);
  private toolsVerifiedSeen = this.options.profile ? toolsVerified(this.options.profile) : false;
  private advancedOpen = false;
  private testing = false;
  private savedProfileId = this.options.profile?.id;
  private unsubscribeCapabilityStatus: (() => void) | null = null;
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
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    this.render();
    this.unsubscribeCapabilityStatus =
      this.options.subscribeCapabilityStatus?.(() => this.render()) ?? null;
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
  }

  private render(): void {
    const currentProfile = this.currentProfile();
    if (
      this.options.kind === "chat" &&
      currentProfile &&
      "reasoningCapabilities" in currentProfile &&
      this.savedStatusApplies()
    ) {
      this.reasoningCapabilities = currentProfile.reasoningCapabilities;
      const probedToolCalling = currentProfile.capabilities?.toolCalling;
      if (probedToolCalling?.probe) {
        this.toolCapabilitySettings = probedToolCalling;
      }
    }
    const { contentEl } = this;
    const { t } = this.options;
    contentEl.empty();
    this.modalEl.addClass("attest-profile-modal-host");
    contentEl.addClass("attest-profile-modal");
    contentEl.createEl("h2", {
      text: t(TITLE_MESSAGE_KEYS[this.options.profile ? "edit" : "add"][this.options.kind]),
    });

    new Setting(contentEl)
      .setName(t("settings.modelProfileModal.name.name"))
      .setDesc(t("settings.modelProfileModal.name.desc", { max: MAX_PROFILE_NAME_LENGTH }))
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

    new Setting(contentEl)
      .setName(t("settings.modelProfileModal.server.name"))
      .setDesc(t("settings.modelProfileModal.server.desc"))
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
          if (this.selectedServer()?.apiFormat !== "openai-compatible") {
            this.reasoningMode = "off";
          } else {
            this.reasoningMode = "auto";
          }
          this.refreshModelControl();
        });
      });

    new Setting(contentEl)
      .setName(t("settings.modelProfileModal.model.name"))
      .setDesc(t("settings.modelProfileModal.model.desc"))
      .addText((text) => {
        this.modelInputEl = text.inputEl;
        text
          .setPlaceholder(t("settings.modelProfileModal.model.placeholder"))
          .setValue(this.modelName)
          .onChange((value) => {
            const nextModelName = value.trim();
            if (nextModelName !== this.modelName) {
              this.reasoningCapabilities = undefined;
              this.toolCapabilitySettings = createToolCapabilitySettings(false);
            }
            this.modelName = nextModelName;
            this.renderModelMenu();
          });
        text.inputEl.addClass("attest-profile-modal__model-input");
        this.modelMenuEl =
          text.inputEl.parentElement?.createDiv({
            cls: "attest-profile-modal__model-menu is-hidden",
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
        button.setButtonText(t("settings.modelProfileModal.model.fetch")).onClick(async () => {
          const server = this.selectedServer();
          if (!server) {
            new Notice(t("settings.modelProfileModal.error.selectServer"));
            return;
          }
          await this.options.fetchModels(server);
          this.refreshModelControl(false);
        }),
      );

    if (this.options.kind === "chat") {
      this.seedCapabilitiesFromDiscovery();
      this.renderCapabilityControls(contentEl);
      const advanced = contentEl.createEl("details", { cls: "attest-profile-modal__advanced" });
      advanced.open = this.advancedOpen;
      advanced.addEventListener("toggle", () => {
        this.advancedOpen = advanced.open;
      });
      advanced.createEl("summary", { text: t("common.advanced") });
      const advancedContent = advanced.createDiv();
      new Setting(advancedContent)
        .setName(t("settings.modelProfileModal.temperature.name"))
        .setDesc(t("settings.modelProfileModal.temperature.desc"))
        .addText((text) =>
          text.setValue(this.temperature).onChange((value) => {
            this.temperature = value.trim();
          }),
        );
      new Setting(advancedContent)
        .setName(t("settings.modelProfileModal.maxTokens.name"))
        .setDesc(t("settings.modelProfileModal.maxTokens.desc"))
        .addText((text) =>
          text.setValue(this.maxTokens).onChange((value) => {
            this.maxTokens = value.trim();
          }),
        );
      new Setting(advancedContent)
        .setName(t("settings.modelProfileModal.contextSize.name"))
        .setDesc(t("settings.modelProfileModal.contextSize.desc"))
        .addText((text) => {
          this.contextLengthInputEl = text.inputEl;
          text.setValue(this.contextLength).onChange((value) => {
            this.contextLength = value.trim();
          });
        });
      this.renderToolsControl(advancedContent);
    }

    renderModalActions(contentEl, {
      t,
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
  }

  onClose(): void {
    this.unsubscribeCapabilityStatus?.();
    this.unsubscribeCapabilityStatus = null;
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
        cls: "attest-profile-modal__model-empty",
        text: this.options.t("settings.modelProfileModal.model.empty"),
      });
      this.modelMenuEl.removeClass("is-hidden");
      return;
    }

    for (const model of models) {
      const option = this.modelMenuEl.createEl("button", {
        cls: "attest-profile-modal__model-option",
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
          this.applyDiscoveredCapabilities(model);
        }
        this.modelName = model.name;
        this.modelInputEl!.value = model.name;
        this.closeModelMenu();
        void this.populateContextLength(model);
        if (this.options.kind === "chat") {
          this.render();
        }
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

  /**
   * A stored capability status describes the model it was measured on, so it is
   * only shown while the edited server and model still match the saved profile.
   */
  private savedStatusApplies(): boolean {
    const currentProfile = this.currentProfile();
    return (
      currentProfile !== undefined &&
      currentProfile.serverProfileId === this.serverProfileId &&
      currentProfile.modelName === this.modelName
    );
  }

  private selectedServer(): ServerProfile | undefined {
    return this.options.servers.find((server) => server.id === this.serverProfileId);
  }

  /**
   * Replaces capability state with whatever the provider already advertises
   * for the newly selected model, so a probe is only needed for what the
   * metadata leaves unknown.
   */
  private applyDiscoveredCapabilities(model: DiscoveredModel): void {
    this.applyDiscoveredReasoning(model);
    this.applyDiscoveredTools(model);
  }

  private applyDiscoveredReasoning(model: DiscoveredModel): void {
    this.reasoningCapabilities = reasoningCapabilitiesFromSnapshot(model.capabilitySnapshot);
    const efforts = this.reasoningCapabilities?.efforts ?? [];
    if (!this.reasoningEffort || !efforts.includes(this.reasoningEffort)) {
      this.reasoningEffort = this.reasoningCapabilities?.defaultEffort ?? "";
    }
  }

  private applyDiscoveredTools(model: DiscoveredModel): void {
    this.toolCapabilitySettings = advertisedToolCapabilities(model);
  }

  /**
   * Applies advertised capabilities of the currently named model whenever the
   * profile has no probe result yet, so reopening a profile does not lose what
   * the provider already reports.
   */
  private seedCapabilitiesFromDiscovery(): void {
    if (this.options.kind !== "chat" || !this.modelName) {
      return;
    }

    const discovered = this.modelsForSelectedServer().find(
      (candidate) => candidate.name === this.modelName,
    );
    if (!discovered) {
      return;
    }

    if (this.reasoningCapabilities?.source !== "probe") {
      this.applyDiscoveredReasoning(discovered);
    }
    if (this.toolCapabilitySettings.probe === undefined) {
      this.applyDiscoveredTools(discovered);
    }
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
    const { t } = this.options;
    if (!this.name || !this.serverProfileId || !this.modelName) {
      this.testing = false;
      new Notice(t("settings.profileModal.error.requiredFields"));
      return;
    }

    if (!isValidProfileName(this.name)) {
      this.testing = false;
      new Notice(t("settings.profileModal.error.nameLength", { max: MAX_PROFILE_NAME_LENGTH }));
      return;
    }

    const existingProfileId = this.savedProfileId ?? this.options.profile?.id;
    if (hasDuplicateProfileName(this.options.profiles, this.name, existingProfileId)) {
      this.testing = false;
      new Notice(t("settings.profileModal.error.nameUnique"));
      return;
    }

    const server = this.selectedServer();
    if (!server || server.isSuspended) {
      this.testing = false;
      new Notice(t("settings.modelProfileModal.error.activeServer"));
      return;
    }

    const model = this.modelsForSelectedServer().find(
      (candidate) => candidate.name === this.modelName,
    );
    if (!model && !this.options.profile) {
      this.testing = false;
      new Notice(t("settings.modelProfileModal.error.fetchModels"));
      return;
    }

    if (this.options.kind === "chat") {
      const allowedEfforts = this.reasoningCapabilities?.efforts;
      if (
        this.reasoningEffort &&
        allowedEfforts &&
        !allowedEfforts.includes(this.reasoningEffort)
      ) {
        this.testing = false;
        new Notice(t("settings.modelProfileModal.error.reasoningEffort"));
        return;
      }
      if (this.reasoningSummary === "auto" && this.reasoningCapabilities?.summary === false) {
        this.testing = false;
        new Notice(t("settings.modelProfileModal.error.reasoningSummary"));
        return;
      }
    }

    const now = new Date().toISOString();
    const baseProfile = {
      id: existingProfileId ?? createProfileId(`${this.options.kind}-model`),
      name: this.name,
      serverProfileId: this.serverProfileId,
      modelName: this.modelName,
      capabilities: this.resolveCapabilities(model),
      isSuspended: this.currentProfile()?.isSuspended,
      suspendedReason: this.currentProfile()?.suspendedReason,
      createdAt: this.currentProfile()?.createdAt ?? now,
      updatedAt: now,
    };

    const profile =
      this.options.kind === "chat"
        ? {
            ...baseProfile,
            toolsEnabled: this.toolsEnabled,
            noteMutationAccess: this.toolsEnabled && this.noteMutationAccess,
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

    const saved = profile as TProfile;
    await this.options.onSave(saved);
    this.savedProfileId = saved.id;
    if (this.testing && this.options.onTest) {
      this.testing = false;
      await this.options.onTest(saved);
      return;
    }
    this.close();
  }

  private resolveCapabilities(model: DiscoveredModel | undefined) {
    const currentProfile = this.currentProfile();
    const contextLength =
      this.options.kind === "chat" ? parsePositiveInteger(this.contextLength) : undefined;

    return {
      chat: this.options.kind === "chat",
      embeddings: this.options.kind === "embedding",
      vision: currentProfile?.capabilities?.vision,
      tools: currentProfile?.capabilities?.tools,
      toolCalling: currentProfile?.capabilities?.toolCalling?.probe
        ? currentProfile.capabilities.toolCalling
        : this.toolCapabilitySettings,
      temperature: model?.capabilities.temperature ?? currentProfile?.capabilities?.temperature,
      maxTokens: model?.capabilities.maxTokens ?? currentProfile?.capabilities?.maxTokens,
      contextLength,
      maxOutputTokens:
        model?.capabilities.maxOutputTokens ?? currentProfile?.capabilities?.maxOutputTokens,
      detectionSource:
        model?.capabilities.detectionSource ??
        currentProfile?.capabilities?.detectionSource ??
        ("format-default" as const),
    };
  }

  private renderCapabilityControls(containerEl: HTMLElement): void {
    renderModelProfileCapabilityControls(this.capabilityControlOptions(containerEl));
  }

  private renderToolsControl(containerEl: HTMLElement): void {
    renderModelProfileToolsControl(this.capabilityControlOptions(containerEl));
  }

  private capabilityControlOptions(
    containerEl: HTMLElement,
  ): ModelProfileCapabilityControlsOptions {
    return {
      t: this.options.t,
      containerEl,
      currentProfile: this.currentProfile() as ChatModelProfile | undefined,
      savedProfileId: this.savedProfileId,
      savedStatusApplies: this.savedStatusApplies(),
      getCapabilityStatus: this.options.getCapabilityStatus,
      reasoningCapabilities: this.reasoningCapabilities,
      toolCapabilities: this.toolCapabilitySettings,
      reasoningMode: this.reasoningMode,
      reasoningEffort: this.reasoningEffort,
      toolsEnabled: this.toolsEnabled,
      toolsVerifiedSeen: this.toolsVerifiedSeen,
      agentVerifiedSeen: this.agentVerifiedSeen,
      onCapabilityTest: () => void this.test(),
      onReasoningModeChange: (mode) => {
        this.reasoningMode = mode;
      },
      onReasoningEffortChange: (effort) => {
        this.reasoningEffort = effort;
      },
      onToolsEnabledChange: (enabled) => {
        this.toolsEnabled = enabled;
      },
      onAgentVerifiedSeenChange: (verified) => {
        this.agentVerifiedSeen = verified;
      },
      onToolsVerifiedSeenChange: (verified) => {
        this.toolsVerifiedSeen = verified;
      },
      onRequestRerender: () => this.render(),
    };
  }

  private async test(): Promise<void> {
    if (!this.options.onTest) return;
    this.testing = true;
    await this.save();
  }

  private currentProfile(): TProfile | undefined {
    return this.savedProfileId
      ? (this.options.resolveProfile?.(this.savedProfileId) ?? this.options.profile)
      : this.options.profile;
  }
}
