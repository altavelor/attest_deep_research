import { App, Modal, Notice, Setting } from "obsidian";

import { DiscoveredModel } from "@adapters/settings";
import { contextLengthInputAfterDiscovery } from "@adapters/settings";
import {
  createToolCapabilitySettings,
  resolveToolCapabilities,
  ToolCapabilitySettings,
} from "@adapters/settings";
import { MAX_PROFILE_NAME_LENGTH } from "@adapters/settings";
import { ChatModelProfile, EmbeddingModelProfile, ServerProfile } from "@adapters/settings";
import { createProfileId, hasDuplicateProfileName, isValidProfileName } from "@adapters/settings";
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
