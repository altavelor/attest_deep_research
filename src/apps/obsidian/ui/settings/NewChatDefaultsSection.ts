import {
  IxplorerSettings,
  NEW_CHAT_SEARCH_MODES,
  NEW_CHAT_SEARCH_MODE_LABELS,
  NewChatSearchMode,
  supportsThinkingMode,
} from "@adapters/settings";
import { DropdownComponent, Setting } from "obsidian";
import { renderCategoryHeading } from "./shared";

export interface NewChatDefaultsSectionOptions {
  settings: IxplorerSettings;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;
}

const THINKING_UNAVAILABLE_HINT =
  "Thinking needs a chat model with a verified Agent capability. Test the model's capabilities to enable it.";

/** Renders the settings that seed every new chat: source, index, mode, model, and active-file context. */
export class NewChatDefaultsSection {
  constructor(private readonly options: NewChatDefaultsSectionOptions) {}

  render(containerEl: HTMLElement): void {
    renderCategoryHeading(
      containerEl,
      "New chat defaults",
      "Starting configuration of every new chat. Saved chats keep their own settings.",
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
    new Setting(containerEl)
      .setName("Default source")
      .setDesc("Evidence sources a new chat starts with.")
      .addDropdown((dropdown) => {
        for (const mode of NEW_CHAT_SEARCH_MODES) {
          dropdown.addOption(mode, NEW_CHAT_SEARCH_MODE_LABELS[mode]);
        }
        dropdown.setValue(this.defaults.searchMode).onChange(async (value) => {
          this.defaults.searchMode = value as NewChatSearchMode;
          await this.options.saveSettings();
        });
      });
  }

  private renderIndex(containerEl: HTMLElement): void {
    const profiles = this.options.settings.indexProfiles.filter(
      (profile) => profile.isSuspended !== true,
    );
    new Setting(containerEl)
      .setName("Default index")
      .setDesc("Index profile a new chat starts with, used whenever the source includes Index.")
      .addDropdown((dropdown) => {
        if (profiles.length === 0) {
          renderEmptyDropdown(dropdown, "No available index profiles");
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
    const model = this.options.settings.chatModelProfiles.find(
      (profile) => profile.id === this.defaults.chatModelProfileId,
    );
    const thinkingAvailable = supportsThinkingMode(model);
    new Setting(containerEl)
      .setName("Default mode")
      .setDesc(
        thinkingAvailable
          ? "Research mode a new chat starts with."
          : `Research mode a new chat starts with. ${THINKING_UNAVAILABLE_HINT}`,
      )
      .addDropdown((dropdown) => {
        dropdown.addOption("instant", "Instant").addOption("thinking", "Thinking");
        if (!thinkingAvailable) {
          const option = dropdown.selectEl.querySelector<HTMLOptionElement>(
            'option[value="thinking"]',
          );
          if (option) {
            option.disabled = true;
            option.title = THINKING_UNAVAILABLE_HINT;
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
    const profiles = this.options.settings.chatModelProfiles.filter(
      (profile) => profile.isSuspended !== true,
    );
    new Setting(containerEl)
      .setName("Default model")
      .setDesc("Chat model profile a new chat starts with.")
      .addDropdown((dropdown) => {
        if (profiles.length === 0) {
          renderEmptyDropdown(dropdown, "No available chat model profiles");
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
    new Setting(containerEl)
      .setName("Include active file as context")
      .setDesc("Automatically include the currently open supported file as explicit chat context.")
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
