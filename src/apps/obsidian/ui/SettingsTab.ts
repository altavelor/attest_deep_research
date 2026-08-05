import { App, PluginSettingTab, setIcon } from "obsidian";

import type IxplorerPlugin from "@apps/obsidian/main";
import { DiscoveredModel, normalizeSettingsState } from "@adapters/settings";
import { AdvancedSettingsSection } from "./settings/AdvancedSettingsSection";
import { SettingsCapabilityProber } from "./settings/SettingsCapabilityProber";
import { IndexProfilesSection } from "./settings/IndexProfilesSection";
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

  display(): void {
    this.unsubscribeCapabilityProbes?.();
    this.unsubscribeCapabilityProbes = this.prober.subscribeAll(() => {
      window.setTimeout(() => this.display(), 0);
    });
    this.indexProfiles.dispose();
    normalizeSettingsState(this.plugin.settings);
    this.containerEl.empty();
    this.containerEl.addClass("ixplorer-settings");

    renderCategoryHeading(this.containerEl, "Ixplorer");
    this.renderQuickStart(this.containerEl);
    new ModelProfilesSection({
      app: this.app,
      settings: this.plugin.settings,
      fetchedModelsByServerId: this.fetchedModelsByServerId,
      prober: this.prober,
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(this.containerEl);
    this.indexProfiles.render(this.gateHost(this.containerEl));
    new NewChatDefaultsSection({
      settings: this.plugin.settings,
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(this.gateHost(this.containerEl));
    new RetrievalSettingsSection({
      app: this.app,
      settings: this.plugin.settings,
      webSourceHealth: this.plugin.webSourceHealth,
      hasActiveChatModel: this.hasActiveChatModel(),
      saveSettings: () => this.plugin.saveSettings(),
      requestRedisplay: () => this.display(),
    }).render(this.containerEl);
    this.renderAdvancedSettings(this.containerEl);

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
    body.createDiv({ cls: "ixplorer-settings__quickstart-title", text: "Quick start" });
    body.createDiv({
      cls: "ixplorer-settings__quickstart-steps",
      text: "1. Add a server → 2. Add a chat model → 3. (optional) Add an index",
    });
  }

  private gateHost(containerEl: HTMLElement): HTMLElement {
    if (this.hasActiveChatModel()) return containerEl;
    const section = containerEl.createDiv({ cls: "ixplorer-settings__gated-section" });
    const hint = section.createDiv({ cls: "ixplorer-settings__gate-hint" });
    setIcon(hint.createSpan({ cls: "ixplorer-settings__gate-hint-icon" }), "info");
    hint.createSpan({ text: "Add a chat model profile first" });
    return section.createDiv({
      cls: "ixplorer-settings__gated-content is-disabled",
      attr: { "aria-disabled": "true", inert: "" },
    });
  }

  private renderAdvancedSettings(containerEl: HTMLElement): void {
    new AdvancedSettingsSection({
      isDebugMode: () => this.plugin.settings.debugMode,
      setDebugMode: (value) => {
        this.plugin.settings.debugMode = value;
      },
      saveSettings: () => this.plugin.saveSettings(),
      refreshChatViews: () => this.plugin.refreshChatViews(),
    }).render(containerEl);
  }
}
