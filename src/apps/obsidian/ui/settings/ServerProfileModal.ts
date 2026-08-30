import { App, Modal, Notice, Setting } from "obsidian";

import {
  ApiFormat,
  CUSTOM_SERVER_PRESET_ID,
  findServerPreset,
  matchServerPreset,
  SERVER_PRESETS,
} from "@core/agent";
import { MAX_PROFILE_NAME_LENGTH } from "@adapters/settings";
import { normalizeUrl } from "@adapters/settings";
import { createProfileId, hasDuplicateProfileName, isValidProfileName } from "@adapters/settings";
import { ServerProfile } from "@adapters/settings";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { renderModalActions } from "./shared";

export interface ServerProfileModalOptions {
  t: Translate;
  getDirection?(): TextDirection;
  profile?: ServerProfile;
  profiles: ServerProfile[];
  onSave(profile: ServerProfile): Promise<void>;
}

export class ServerProfileModal extends Modal {
  private name = this.options.profile?.name ?? "";
  private apiFormat: ApiFormat = this.options.profile?.apiFormat ?? "openai-compatible";
  private baseUrl = this.options.profile?.baseUrl ?? "";
  private apiKey = this.options.profile?.apiKey ?? "";
  private presetId =
    matchServerPreset(this.options.profile?.baseUrl ?? "")?.id ?? CUSTOM_SERVER_PRESET_ID;
  private nameInput?: HTMLInputElement;
  private baseUrlInput?: HTMLInputElement;
  private apiFormatSelect?: HTMLSelectElement;

  constructor(
    app: App,
    private readonly options: ServerProfileModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    const { contentEl } = this;
    const { t } = this.options;
    contentEl.empty();
    this.modalEl.addClass("attest-profile-modal-host");
    contentEl.addClass("attest-profile-modal");
    contentEl.createEl("h2", {
      text: this.options.profile
        ? t("settings.serverModal.editTitle")
        : t("settings.serverModal.addTitle"),
    });

    new Setting(contentEl)
      .setName(t("settings.serverModal.preset.name"))
      .setDesc(t("settings.serverModal.preset.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption(CUSTOM_SERVER_PRESET_ID, t("settings.serverModal.preset.custom"));
        for (const preset of SERVER_PRESETS) {
          dropdown.addOption(preset.id, preset.label);
        }
        dropdown.setValue(this.presetId).onChange((value) => {
          this.applyPreset(value);
        });
      });

    new Setting(contentEl)
      .setName(t("settings.serverModal.name.name"))
      .setDesc(t("settings.serverModal.name.desc", { max: MAX_PROFILE_NAME_LENGTH }))
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        this.nameInput = text.inputEl;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

    new Setting(contentEl)
      .setName(t("settings.serverModal.apiFormat.name"))
      .setDesc(t("settings.serverModal.apiFormat.desc"))
      .addDropdown((dropdown) => {
        this.apiFormatSelect = dropdown.selectEl;
        dropdown
          .addOption("openai-compatible", t("settings.serverModal.apiFormat.openaiCompatible"))
          .addOption("ollama", t("settings.serverModal.apiFormat.ollama"))
          .addOption("anthropic", t("settings.serverModal.apiFormat.anthropic"))
          .setValue(this.apiFormat)
          .onChange((value) => {
            this.apiFormat = value as ApiFormat;
          });
      });

    new Setting(contentEl)
      .setName(t("settings.serverModal.baseUrl.name"))
      .setDesc(t("settings.serverModal.baseUrl.desc"))
      .addText((text) => {
        this.baseUrlInput = text.inputEl;
        text.setValue(this.baseUrl).onChange((value) => {
          this.baseUrl = value.trim();
        });
      });

    new Setting(contentEl)
      .setName(t("settings.serverModal.apiKey.name"))
      .setDesc(t("settings.serverModal.apiKey.desc"))
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(this.apiKey).onChange((value) => {
          this.apiKey = value.trim();
        });
      });

    renderModalActions(contentEl, {
      t,
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
  }

  onClose(): void {
    this.nameInput = undefined;
    this.baseUrlInput = undefined;
    this.apiFormatSelect = undefined;
    this.contentEl.empty();
  }

  /**
   * Fills the endpoint fields from the selected provider. The name is only
   * suggested while it is still empty or still carries the previous preset's
   * label, so a name the user typed survives, and every field stays editable.
   */
  private applyPreset(presetId: string): void {
    const previousLabel = findServerPreset(this.presetId)?.label;
    this.presetId = presetId;
    const preset = findServerPreset(presetId);
    if (!preset) {
      return;
    }

    this.baseUrl = preset.baseUrl;
    this.apiFormat = preset.apiFormat;
    if (this.baseUrlInput) {
      this.baseUrlInput.value = preset.baseUrl;
    }
    if (this.apiFormatSelect) {
      this.apiFormatSelect.value = preset.apiFormat;
    }
    if (!this.name || this.name === previousLabel) {
      this.name = preset.label;
      if (this.nameInput) {
        this.nameInput.value = preset.label;
      }
    }
  }

  private async save(): Promise<void> {
    const { t } = this.options;
    if (!this.name || !this.baseUrl) {
      new Notice(t("settings.profileModal.error.requiredFields"));
      return;
    }

    if (!isValidProfileName(this.name)) {
      new Notice(t("settings.profileModal.error.nameLength", { max: MAX_PROFILE_NAME_LENGTH }));
      return;
    }

    if (hasDuplicateProfileName(this.options.profiles, this.name, this.options.profile?.id)) {
      new Notice(t("settings.profileModal.error.nameUnique"));
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
