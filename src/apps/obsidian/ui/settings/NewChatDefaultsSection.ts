import {
  IxplorerSettings,
  NEW_CHAT_SEARCH_MODES,
  NewChatSearchMode,
  supportsThinkingMode,
} from "@adapters/settings";
import { DropdownComponent, Setting } from "obsidian";
import type { MessageKey, Translate } from "@adapters/i18n";
import { renderCategoryHeading } from "./shared";

export interface NewChatDefaultsSectionOptions {
  t: Translate;
  settings: IxplorerSettings;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;
}

const SEARCH_MODE_MESSAGE_KEYS: Record<NewChatSearchMode, MessageKey> = {
  none: "settings.newChatDefaults.source.none",
  indexOnly: "settings.newChatDefaults.source.indexOnly",
  webOnly: "settings.newChatDefaults.source.webOnly",
  indexAndWeb: "settings.newChatDefaults.source.indexAndWeb",
};

/** Renders the settings that seed every new chat: source, index, mode, model, and active-file context. */
export class NewChatDefaultsSection {
  constructor(private readonly options: NewChatDefaultsSectionOptions) {}

  render(containerEl: HTMLElement): void {
    const { t } = this.options;
    renderCategoryHeading(
      containerEl,
      t("settings.newChatDefaults.heading"),
      t("settings.newChatDefaults.desc"),
    );
    this.renderSource(containerEl);
    this.renderIndex(containerEl);
    this.renderMode(containerEl);
    this.renderModel(containerEl);
    this.renderActiveFileContext(containerEl);
  }

  private get defaults(): IxplorerSettings["newChatDefaults"] {
    return this.options.settings.newChatDefaults;
  }

  private renderSource(containerEl: HTMLElement): void {
    const { t } = this.options;
    new Setting(containerEl)
      .setName(t("settings.newChatDefaults.source.name"))
      .setDesc(t("settings.newChatDefaults.source.desc"))
      .addDropdown((dropdown) => {
        for (const mode of NEW_CHAT_SEARCH_MODES) {
          dropdown.addOption(mode, t(SEARCH_MODE_MESSAGE_KEYS[mode]));
        }
        dropdown.setValue(this.defaults.searchMode).onChange(async (value) => {
          this.defaults.searchMode = value as NewChatSearchMode;
          await this.options.saveSettings();
        });
      });
  }

  private renderIndex(containerEl: HTMLElement): void {
    const { t } = this.options;
    const profiles = this.options.settings.indexProfiles.filter(
      (profile) => profile.isSuspended !== true,
    );
    new Setting(containerEl)
      .setName(t("settings.newChatDefaults.index.name"))
      .setDesc(t("settings.newChatDefaults.index.desc"))
      .addDropdown((dropdown) => {
        if (profiles.length === 0) {
          renderEmptyDropdown(dropdown, t("settings.newChatDefaults.index.empty"));
          return;
        }
        for (const profile of profiles) dropdown.addOption(profile.id, profile.name);
        dropdown.setValue(this.defaults.indexProfileId).onChange(async (value) => {
          this.defaults.indexProfileId = value;
          await this.options.saveSettings();
        });
      });
  }

  private renderMode(containerEl: HTMLElement): void {
    const { t } = this.options;
    const model = this.options.settings.chatModelProfiles.find(
      (profile) => profile.id === this.defaults.chatModelProfileId,
    );
    const thinkingAvailable = supportsThinkingMode(model);
    const unavailableHint = t("settings.newChatDefaults.mode.thinkingUnavailable");
    new Setting(containerEl)
      .setName(t("settings.newChatDefaults.mode.name"))
      .setDesc(
        thinkingAvailable
          ? t("settings.newChatDefaults.mode.desc")
          : t("settings.newChatDefaults.mode.descBlocked", { hint: unavailableHint }),
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("instant", t("settings.newChatDefaults.mode.instant"))
          .addOption("thinking", t("settings.newChatDefaults.mode.thinking"));
        if (!thinkingAvailable) {
          const option = dropdown.selectEl.querySelector<HTMLOptionElement>(
            'option[value="thinking"]',
          );
          if (option) {
            option.disabled = true;
            option.title = unavailableHint;
          }
        }
        dropdown.setValue(thinkingAvailable ? this.defaults.researchMode : "instant");
        dropdown.onChange(async (value) => {
          this.defaults.researchMode =
            value === "thinking" && thinkingAvailable ? "thinking" : "instant";
          await this.options.saveSettings();
        });
      });
  }

  private renderModel(containerEl: HTMLElement): void {
    const { t } = this.options;
    const profiles = this.options.settings.chatModelProfiles.filter(
      (profile) => profile.isSuspended !== true,
    );
    new Setting(containerEl)
      .setName(t("settings.newChatDefaults.model.name"))
      .setDesc(t("settings.newChatDefaults.model.desc"))
      .addDropdown((dropdown) => {
        if (profiles.length === 0) {
          renderEmptyDropdown(dropdown, t("settings.newChatDefaults.model.empty"));
          return;
        }
        for (const profile of profiles) dropdown.addOption(profile.id, profile.name);
        dropdown.setValue(this.defaults.chatModelProfileId).onChange(async (value) => {
          this.defaults.chatModelProfileId = value;
          await this.options.saveSettings();
          this.options.requestRedisplay();
        });
      });
  }

  private renderActiveFileContext(containerEl: HTMLElement): void {
    const { t } = this.options;
    new Setting(containerEl)
      .setName(t("settings.newChatDefaults.activeFile.name"))
      .setDesc(t("settings.newChatDefaults.activeFile.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.defaults.includeActiveFileContext).onChange(async (value) => {
          this.defaults.includeActiveFileContext = value;
          await this.options.saveSettings();
        }),
      );
  }
}

function renderEmptyDropdown(dropdown: DropdownComponent, label: string): void {
  dropdown.addOption("", label);
  dropdown.setValue("");
  dropdown.setDisabled(true);
}
