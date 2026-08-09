import { App, PluginSettingTab, setIcon } from "obsidian";

import type IxplorerPlugin from "@apps/obsidian/main";
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
export class IxplorerSettingTab extends PluginSettingTab {
  private unsubscribeCapabilityProbes: (() => void) | null = null;
  private readonly fetchedModelsByServerId = new Map<string, DiscoveredModel[]>();
  private metadataRefreshStarted = false;
  private readonly prober: SettingsCapabilityProber;
  private readonly indexProfiles: IndexProfilesSection;

  constructor(
    app: App,
    private readonly plugin: IxplorerPlugin,
  ) {
    super(app, plugin);
    this.prober = new SettingsCapabilityProber({
      plugin: this.plugin,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      requestRedisplay: () => this.display(),
    });
    this.indexProfiles = new IndexProfilesSection(this.app, this.plugin, () => this.display());
  }

  /**
   * Rebuilds the whole tab. Every section redisplays through here, so the
   * scroll offset is captured and restored around the rebuild: without it a
   * toggle deep in the list throws the user back to the top of the settings.
   */
  display(): void {
    const scrollTop = this.containerEl.scrollTop;
    this.unsubscribeCapabilityProbes?.();
    this.unsubscribeCapabilityProbes = this.prober.subscribeAll(() => {
      window.setTimeout(() => this.display(), 0);
    });
    this.indexProfiles.dispose();
    normalizeSettingsState(this.plugin.settings);
    this.containerEl.empty();
    this.containerEl.addClass("ixplorer-settings");
    this.containerEl.setAttr("dir", this.plugin.getTranslator().direction);

    renderCategoryHeading(this.containerEl, this.plugin.translate("settings.tab.heading"));
    this.renderQuickStart(this.containerEl);
    new ModelProfilesSection({
      app: this.app,
      t: this.plugin.translate,
      getDirection: () => this.plugin.getTranslator().direction,
      settings: this.plugin.settings,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      prober: this.prober,
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(this.containerEl);
    this.indexProfiles.render(this.gateHost(this.containerEl));
    new NewChatDefaultsSection({
      t: this.plugin.translate,
      settings: this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(this.gateHost(this.containerEl));
    new RetrievalSettingsSection({
      app: this.app,
      t: this.plugin.translate,
      getDirection: () => this.plugin.getTranslator().direction,
      settings: this.plugin.settings,
      webSourceHealth: this.plugin.webSourceHealth,
      hasActiveChatModel: this.hasActiveChatModel(),
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(this.containerEl);
    this.renderLanguageSettings(this.containerEl);
    this.renderAdvancedSettings(this.containerEl);
    this.containerEl.scrollTop = scrollTop;

    if (!this.metadataRefreshStarted) {
      this.metadataRefreshStarted = true;
      void this.prober.refreshMetadataCapabilities();
    }
  }

  hide(): void {
    this.unsubscribeCapabilityProbes?.();
    this.unsubscribeCapabilityProbes = null;
    this.indexProfiles.dispose();
  }

  private hasActiveChatModel(): boolean {
    return this.plugin.settings.chatModelProfiles.some((profile) => !profile.isSuspended);
  }

  private renderQuickStart(containerEl: HTMLElement): void {
    if (this.plugin.settings.serverProfiles.length > 0) return;
    const banner = containerEl.createDiv({ cls: "ixplorer-settings__quickstart" });
    setIcon(banner.createSpan({ cls: "ixplorer-settings__quickstart-icon" }), "rocket");
    const body = banner.createDiv({ cls: "ixplorer-settings__quickstart-body" });
    body.createDiv({
      cls: "ixplorer-settings__quickstart-title",
      text: this.plugin.translate("settings.tab.quickStart.title"),
    });
    body.createDiv({
      cls: "ixplorer-settings__quickstart-steps",
      text: this.plugin.translate("settings.tab.quickStart.steps"),
    });
  }

  private gateHost(containerEl: HTMLElement): HTMLElement {
    if (this.hasActiveChatModel()) return containerEl;
    const section = containerEl.createDiv({ cls: "ixplorer-settings__gated-section" });
    const hint = section.createDiv({ cls: "ixplorer-settings__gate-hint" });
    setIcon(hint.createSpan({ cls: "ixplorer-settings__gate-hint-icon" }), "info");
    hint.createSpan({ text: this.plugin.translate("settings.tab.gateHint") });
    return section.createDiv({
      cls: "ixplorer-settings__gated-content is-disabled",
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
      saveSettings: () => this.plugin.saveSettings(),
      applyLanguage: () => this.plugin.applyUiLanguage(),
      requestRedisplay: () => this.display(),
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
      saveSettings: () => this.plugin.saveSettings(),
      refreshChatViews: () => this.plugin.refreshChatViews(),
    }).render(containerEl);
  }
}
