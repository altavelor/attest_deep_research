import { App, Modal, Notice, Setting } from "obsidian";

import { ApiFormat } from "@core/agent";
import { MAX_PROFILE_NAME_LENGTH } from "@adapters/settings";
import { normalizeUrl } from "@adapters/settings";
import { createProfileId, hasDuplicateProfileName, isValidProfileName } from "@adapters/settings";
import { ServerProfile } from "@adapters/settings";
import { renderModalActions } from "./shared";

export interface ServerProfileModalOptions {
  profile?: ServerProfile;
  profiles: ServerProfile[];
  onSave(profile: ServerProfile): Promise<void>;
}

export class ServerProfileModal extends Modal {
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
