import { App, PluginSettingTab, Setting, setIcon } from "obsidian";
import type { SettingDefinitionItem, SettingGroup } from "obsidian";

import type AttestPlugin from "@apps/obsidian/main";
import { DiscoveredModel, normalizeSettingsState } from "@adapters/settings";
import { AdvancedSettingsSection } from "./settings/AdvancedSettingsSection";
import { SettingsCapabilityProber } from "./settings/SettingsCapabilityProber";
import { IndexProfilesSection } from "./settings/IndexProfilesSection";
import { LanguageSettingsSection } from "./settings/LanguageSettingsSection";
import { ModelProfilesSection } from "./settings/ModelProfilesSection";
import { NewChatDefaultsSection } from "./settings/NewChatDefaultsSection";
import { RetrievalSettingsSection } from "./settings/RetrievalSettingsSection";
import { renderCategoryHeading } from "./settings/shared";

/** Thin Obsidian settings-tab composition root for focused settings sections. */
export class AttestSettingTab extends PluginSettingTab {
  private unsubscribeCapabilityProbes: (() => void) | null = null;
  private readonly fetchedModelsByServerId = new Map<string, DiscoveredModel[]>();
  private metadataRefreshStarted = false;
  private readonly prober: SettingsCapabilityProber;
  private readonly indexProfiles: IndexProfilesSection;
  private redisplayTimer: number | null = null;

  constructor(
    app: App,
    private readonly plugin: AttestPlugin,
  ) {
    super(app, plugin);
    this.prober = new SettingsCapabilityProber({
      plugin: this.plugin,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      requestRedisplay: () => this.redisplay(),
    });
    this.indexProfiles = new IndexProfilesSection(this.app, this.plugin, () => this.redisplay());
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: this.plugin.translate("settings.tab.heading"),
        aliases: ["AI", "models", "semantic search", "web search", "retrieval", "indexing"],
        render: (setting: Setting, _group: SettingGroup) => {
          setting.settingEl.empty();
          setting.settingEl.addClass("attest-settings-definition");
          this.renderSettings(setting.settingEl);
          return () => this.cleanupRenderedSettings();
        },
      },
    ];
  }

  /**
   * Rebuilds the whole tab. Every section redisplays through here, so the
   * scroll offset is captured and restored around the rebuild: without it a
   * toggle deep in the list throws the user back to the top of the settings.
   */
  display(): void {
    this.renderSettings(this.containerEl);
  }

  private renderSettings(containerEl: HTMLElement): void {
    const scrollTop = this.containerEl.scrollTop;
    this.cleanupRenderedSettings();
    this.unsubscribeCapabilityProbes = this.prober.subscribeAll(() => {
      if (this.redisplayTimer !== null) window.clearTimeout(this.redisplayTimer);
      this.redisplayTimer = window.setTimeout(() => {
        this.redisplayTimer = null;
        this.redisplay();
      }, 0);
    });
    normalizeSettingsState(this.plugin.settings);
    containerEl.empty();
    containerEl.addClass("attest-settings");
    containerEl.setAttr("dir", this.plugin.getTranslator().direction);

    renderCategoryHeading(containerEl, this.plugin.translate("settings.tab.heading"));
    this.renderQuickStart(containerEl);
    this.renderSetupEntry(containerEl);
    new ModelProfilesSection({
      app: this.app,
      t: this.plugin.translate,
      getDirection: () => this.plugin.getTranslator().direction,
      settings: this.plugin.settings,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      prober: this.prober,
      saveSettings: () => this.saveSettings(),
      requestRedisplay: () => this.redisplay(),
    }).render(containerEl);
    this.indexProfiles.render(this.gateHost(containerEl));
    new NewChatDefaultsSection({
      t: this.plugin.translate,
      settings: this.plugin.settings,
      saveSettings: () => this.saveSettings(),
      requestRedisplay: () => this.redisplay(),
    }).render(this.gateHost(containerEl));
    new RetrievalSettingsSection({
      app: this.app,
      t: this.plugin.translate,
      getDirection: () => this.plugin.getTranslator().direction,
      settings: this.plugin.settings,
      webSourceHealth: this.plugin.webSourceHealth,
      hasActiveChatModel: this.hasActiveChatModel(),
      saveSettings: () => this.saveSettings(),
      requestRedisplay: () => this.redisplay(),
    }).render(containerEl);
    this.renderLanguageSettings(containerEl);
    this.renderAdvancedSettings(containerEl);
    this.containerEl.scrollTop = scrollTop;

    if (!this.metadataRefreshStarted) {
      this.metadataRefreshStarted = true;
      void this.prober.refreshMetadataCapabilities();
    }
  }

  hide(): void {
    this.cleanupRenderedSettings();
  }

  private cleanupRenderedSettings(): void {
    if (this.redisplayTimer !== null) {
      window.clearTimeout(this.redisplayTimer);
      this.redisplayTimer = null;
    }
    this.unsubscribeCapabilityProbes?.();
    this.unsubscribeCapabilityProbes = null;
    this.indexProfiles.dispose();
  }

  private redisplay(): void {
    const update = Reflect.get(this, "update");
    const render = typeof update === "function" ? update : Reflect.get(this, "display");
    if (typeof render === "function") Reflect.apply(render, this, []);
  }

  /**
   * Saves and lets open chat views pick the change up. The composer builds its
   * model and index lists once, so without this a profile added while a chat is
   * open stays missing from its menus.
   */
  private async saveSettings(): Promise<void> {
    await this.plugin.saveSettings();
    this.plugin.refreshChatViews();
  }

  private hasActiveChatModel(): boolean {
    return this.plugin.settings.chatModelProfiles.some((profile) => !profile.isSuspended);
  }

  /**
   * Offers the wizard from settings. A configured vault gets the re-run row,
   * which reopens the wizard on the profiles it created and updates them
   * instead of adding a second set.
   */
  private renderSetupEntry(containerEl: HTMLElement): void {
    if (this.plugin.settings.serverProfiles.length === 0) return;
    new Setting(containerEl)
      .setName(this.plugin.translate("settings.tab.setup.name"))
      .setDesc(this.plugin.translate("settings.tab.setup.rerunDesc"))
      .addButton((button) =>
        button
          .setButtonText(this.plugin.translate("settings.tab.setup.rerunAction"))
          .onClick(() => this.plugin.openOnboarding(() => this.redisplay())),
      );
  }

  private renderQuickStart(containerEl: HTMLElement): void {
    if (this.plugin.settings.serverProfiles.length > 0) return;
    const banner = containerEl.createDiv({ cls: "attest-settings__quickstart" });
    setIcon(banner.createSpan({ cls: "attest-settings__quickstart-icon" }), "rocket");
    const body = banner.createDiv({ cls: "attest-settings__quickstart-body" });
    body.createDiv({
      cls: "attest-settings__quickstart-title",
      text: this.plugin.translate("settings.tab.quickStart.title"),
    });
    body.createDiv({
      cls: "attest-settings__quickstart-steps",
      text: this.plugin.translate("settings.tab.quickStart.steps"),
    });
    const action = body.createEl("button", {
      cls: "mod-cta attest-settings__quickstart-action",
      text: this.plugin.translate("settings.tab.setup.action"),
    });
    action.addEventListener("click", () => this.plugin.openOnboarding(() => this.redisplay()));
  }

  private gateHost(containerEl: HTMLElement): HTMLElement {
    if (this.hasActiveChatModel()) return containerEl;
    const section = containerEl.createDiv({ cls: "attest-settings__gated-section" });
    const hint = section.createDiv({ cls: "attest-settings__gate-hint" });
    setIcon(hint.createSpan({ cls: "attest-settings__gate-hint-icon" }), "info");
    hint.createSpan({ text: this.plugin.translate("settings.tab.gateHint") });
    return section.createDiv({
      cls: "attest-settings__gated-content is-disabled",
      attr: { "aria-disabled": "true", inert: "" },
    });
  }

  private renderLanguageSettings(containerEl: HTMLElement): void {
    new LanguageSettingsSection({
      t: this.plugin.translate,
      getLanguage: () => this.plugin.settings.uiLanguage,
      setLanguage: (value) => {
        this.plugin.settings.uiLanguage = value;
      },
      saveSettings: () => this.saveSettings(),
      applyLanguage: () => this.plugin.applyUiLanguage(),
      requestRedisplay: () => this.redisplay(),
      refreshChatViews: () => this.plugin.refreshChatViews(),
    }).render(containerEl);
  }

  private renderAdvancedSettings(containerEl: HTMLElement): void {
    new AdvancedSettingsSection({
      t: this.plugin.translate,
      isDebugMode: () => this.plugin.settings.debugMode,
      setDebugMode: (value) => {
        this.plugin.settings.debugMode = value;
      },
      saveSettings: () => this.saveSettings(),
      refreshChatViews: () => this.plugin.refreshChatViews(),
    }).render(containerEl);
  }
}
