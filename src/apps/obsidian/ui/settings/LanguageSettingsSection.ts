import { Setting } from "obsidian";

import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isLocalePreference } from "@core/i18n";
import type { LocalePreference } from "@core/i18n";
import type { Translate } from "@adapters/i18n";
import { renderCategoryHeading } from "./shared";

export interface LanguageSettingsSectionOptions {
  t: Translate;
  getLanguage(): LocalePreference;
  setLanguage(value: LocalePreference): void;
  saveSettings(): Promise<void>;
  applyLanguage(): void;
  requestRedisplay(): void;
  refreshChatViews(): void;
}

/**
 * Renders the interface-language picker. Selecting a language persists it,
 * rebinds the translator, and redisplays the settings tab and open chat views
 * so the new language applies without restarting Obsidian.
 */
export class LanguageSettingsSection {
  constructor(private readonly options: LanguageSettingsSectionOptions) {}

  render(containerEl: HTMLElement): void {
    const { t } = this.options;
    renderCategoryHeading(containerEl, t("settings.language.heading"));
    new Setting(containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("auto", t("settings.language.auto"));
        for (const locale of SUPPORTED_LOCALES) {
          dropdown.addOption(locale, LOCALE_NATIVE_NAMES[locale]);
        }
        dropdown.setValue(this.options.getLanguage()).onChange(async (value) => {
          if (!isLocalePreference(value)) {
            return;
          }
          this.options.setLanguage(value);
          await this.options.saveSettings();
          this.options.applyLanguage();
          this.options.refreshChatViews();
          this.options.requestRedisplay();
        });
      });
  }
}
