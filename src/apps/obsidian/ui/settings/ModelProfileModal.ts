import { App, Modal, Notice, Setting } from "obsidian";

import { DiscoveredModel } from "@adapters/settings";
import { contextLengthInputAfterDiscovery } from "@adapters/settings";
import { createToolCapabilitySettings, ToolCapabilitySettings } from "@adapters/settings";
import { MAX_PROFILE_NAME_LENGTH } from "@adapters/settings";
import { ChatModelProfile, EmbeddingModelProfile, ServerProfile } from "@adapters/settings";
import { createProfileId, hasDuplicateProfileName, isValidProfileName } from "@adapters/settings";
import {
  formatEffortLabel,
  formatCapabilityVerificationStatus,
  reasoningVerified,
  toolsVerified,
  verificationBlockReason,
  CapabilityVerificationState,
} from "@adapters/settings";
import { parsePositiveInteger } from "@shared";
import { optionalNumber, renderModalActions } from "./shared";

type ModelProfile = ChatModelProfile | EmbeddingModelProfile;

export interface ModelProfileModalOptions<TProfile extends ModelProfile> {
  kind: "chat" | "embedding";
  profile?: TProfile;
  servers: ServerProfile[];
  profiles: TProfile[];
  fetchedModelsByServerId: Map<string, DiscoveredModel[]>;
  fetchModels(server: ServerProfile): Promise<DiscoveredModel[]>;
  fetchContextLength?: (server: ServerProfile, modelName: string) => Promise<number | undefined>;
  onSave(profile: TProfile): Promise<void>;
  onTest?(profile: TProfile): Promise<void>;
  getCapabilityStatus?(profileId: string): CapabilityVerificationState;
  subscribeCapabilityStatus?(listener: () => void): () => void;
  resolveProfile?(profileId: string): TProfile | undefined;
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
  private reasoningMode =
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
      "reasoningCapabilities" in currentProfile
    ) {
      this.reasoningCapabilities = currentProfile.reasoningCapabilities;
    }
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

    const capabilityHeading = new Setting(contentEl).setName("Capabilities").setHeading();
    capabilityHeading.settingEl.addClass("ixplorer-profile-modal__capabilities-heading");
    if (this.options.kind === "chat") {
      capabilityHeading.setDesc(this.capabilityStatus()).addButton((button) =>
        button
          .setIcon("flask-conical")
          .setTooltip(
            `${this.hasCapabilityTestResult() ? "Re-test" : "Test"} capabilities — ${this.capabilityStatus()}`,
          )
          .onClick(() => void this.test()),
      );
      this.renderReasoningControls(contentEl);
      const advanced = contentEl.createEl("details", { cls: "ixplorer-profile-modal__advanced" });
      advanced.createEl("summary", { text: "Advanced" });
      const advancedContent = advanced.createDiv();
      new Setting(advancedContent)
        .setName("Temperature")
        .setDesc("Optional. Controls response randomness; blank uses the provider or app default.")
        .addText((text) =>
          text.setValue(this.temperature).onChange((value) => {
            this.temperature = value.trim();
          }),
        );
      new Setting(advancedContent)
        .setName("Max tokens")
        .setDesc(
          "Optional. Limits response length; blank uses provider/model default or 4096 for Anthropic.",
        )
        .addText((text) =>
          text.setValue(this.maxTokens).onChange((value) => {
            this.maxTokens = value.trim();
          }),
        );
      new Setting(advancedContent)
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
      this.renderToolsControl(advancedContent);
    }

    renderModalActions(contentEl, {
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
      this.testing = false;
      new Notice("Fill all required fields.");
      return;
    }

    if (!isValidProfileName(this.name)) {
      this.testing = false;
      new Notice(`Name must be 1-${MAX_PROFILE_NAME_LENGTH} characters.`);
      return;
    }

    const existingProfileId = this.savedProfileId ?? this.options.profile?.id;
    if (hasDuplicateProfileName(this.options.profiles, this.name, existingProfileId)) {
      this.testing = false;
      new Notice("Name must be unique.");
      return;
    }

    const server = this.selectedServer();
    if (!server || server.isSuspended) {
      this.testing = false;
      new Notice("Select an active server profile.");
      return;
    }

    const model = this.modelsForSelectedServer().find(
      (candidate) => candidate.name === this.modelName,
    );
    if (!model && !this.options.profile) {
      this.testing = false;
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
        this.testing = false;
        new Notice("Reasoning effort must be provider-default or capability-verified.");
        return;
      }
      if (this.reasoningSummary === "auto" && this.reasoningCapabilities?.summary === false) {
        this.testing = false;
        new Notice("Reasoning summaries were not verified for this profile.");
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
      toolCalling: currentProfile?.capabilities?.toolCalling ?? this.toolCapabilitySettings,
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

  private renderReasoningControls(containerEl: HTMLElement): void {
    const verified = reasoningVerified(this.reasoningCapabilities);
    if (!verified) {
      this.reasoningMode = "off";
    } else if (!this.agentVerifiedSeen) {
      this.reasoningMode = "on";
    }
    this.agentVerifiedSeen = verified;
    const reason = verificationBlockReason(
      verified,
      this.reasoningCapabilities?.source === "probe",
    );
    const agenticSetting = new Setting(containerEl)
      .setName("Agentic mode")
      .setDesc("Enable verified agent mode support.")
      .addToggle((toggle) => {
        toggle.setValue(this.reasoningMode === "on");
        toggle.setDisabled(!verified);
        toggle.onChange((value) => {
          this.reasoningMode = value ? "on" : "off";
          this.render();
        });
      });
    this.applyDisabledState(agenticSetting, !verified, reason);

    const effortValues = new Set(this.reasoningCapabilities?.efforts ?? []);
    if (this.reasoningEffort) effortValues.add(this.reasoningEffort);
    const effortDisabled = !verified || this.reasoningMode === "off";
    const effortReason = !verified
      ? reason
      : this.reasoningMode === "off"
        ? "Enable agentic mode to choose a reasoning effort."
        : undefined;
    const effortSetting = new Setting(containerEl)
      .setName("Reasoning effort")
      .setDesc("Auto uses the provider default or a verified value.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Auto");
        for (const effort of effortValues) dropdown.addOption(effort, formatEffortLabel(effort));
        dropdown.setValue(this.reasoningEffort).onChange((value) => {
          this.reasoningEffort = value;
        });
        dropdown.setDisabled(effortDisabled);
      });
    this.applyDisabledState(effortSetting, effortDisabled, effortReason);
  }

  private renderToolsControl(containerEl: HTMLElement): void {
    const profile = this.currentProfile() as ChatModelProfile | undefined;
    const verified = profile ? toolsVerified(profile) : false;
    if (!verified) {
      this.toolsEnabled = false;
    }
    const reason = verificationBlockReason(
      verified,
      Boolean(profile?.capabilities?.toolCalling?.probe),
    );
    const toolsSetting = new Setting(containerEl)
      .setName("Tools")
      .setDesc(
        "Let this model call note tools — read, search, and (with edit access) modify vault notes. " +
          "Index and web research tools in Thinking mode are governed separately.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.toolsEnabled);
        toggle.setDisabled(!verified);
        toggle.onChange((value) => {
          this.toolsEnabled = value;
        });
      });
    this.applyDisabledState(toolsSetting, !verified, reason);
  }

  private applyDisabledState(
    setting: Setting,
    disabled: boolean,
    reason: string | undefined,
  ): void {
    if (!disabled) return;
    setting.settingEl.addClass("ixplorer-profile-modal__setting--disabled");
    if (reason) {
      setting.descEl.createDiv({ cls: "ixplorer-profile-modal__warning", text: reason });
    }
  }

  private capabilityStatus(): string {
    const status = this.savedProfileId
      ? this.options.getCapabilityStatus?.(this.savedProfileId)
      : undefined;
    if (status) return formatCapabilityVerificationStatus(status);
    const profile = this.currentProfile() as ChatModelProfile | undefined;
    const tools = profile?.capabilities?.toolCalling?.probe;
    const agent = profile?.reasoningCapabilities;
    const toolStatus = !tools
      ? "tools support: Not tested"
      : tools.calls
        ? "tools support: Verified"
        : "tools support: Not verified";
    const agentStatus =
      !agent || agent.source !== "probe"
        ? "agent mode support: Not tested"
        : agent.responses
          ? "agent mode support: Verified"
          : "agent mode support: Not verified";
    return `${toolStatus} · ${agentStatus}`;
  }

  private hasCapabilityTestResult(): boolean {
    const profile = this.currentProfile() as ChatModelProfile | undefined;
    return Boolean(
      profile?.capabilities?.toolCalling?.probe ||
      profile?.reasoningCapabilities?.source === "probe",
    );
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
