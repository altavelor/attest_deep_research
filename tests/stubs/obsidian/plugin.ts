import { Component } from "./component";
import type { App, WorkspaceLeaf } from "./workspace";
import type { View } from "./view";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
}

export interface Command {
  id: string;
  name: string;
  icon?: string;
  callback?: () => unknown;
}

export class PluginSettingTab {
  containerEl: HTMLElement;

  constructor(
    public app: App,
    public plugin: unknown,
  ) {
    this.containerEl = document.createElement("div");
  }
}

/**
 * Plugin host that records what a plugin registers — views, commands, settings
 * tabs and persisted data — and releases all of it on `unload`, mirroring the
 * ownership Obsidian's Plugin base class provides.
 */
export class Plugin extends Component {
  readonly commands: Command[] = [];
  readonly settingTabs: PluginSettingTab[] = [];
  private data: unknown = null;

  constructor(
    public app: App,
    public manifest: PluginManifest = { id: "ixplorer", name: "Ixplorer", version: "0.0.0" },
  ) {
    super();
  }

  registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void {
    this.app.workspace.registerViewFactory(type, factory);
    this.register(() => {
      if (this.app.workspace.getViewFactory(type) === factory) {
        this.app.workspace.unregisterViewFactory(type);
      }
    });
  }

  addCommand(command: Command): Command {
    this.commands.push(command);
    this.register(() => {
      const index = this.commands.indexOf(command);
      if (index >= 0) this.commands.splice(index, 1);
    });
    return command;
  }

  removeCommand(commandId: string): void {
    const index = this.commands.findIndex((command) => command.id === commandId);
    if (index >= 0) this.commands.splice(index, 1);
  }

  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
    this.register(() => {
      const index = this.settingTabs.indexOf(tab);
      if (index >= 0) this.settingTabs.splice(index, 1);
    });
  }

  async loadData(): Promise<unknown> {
    return this.data;
  }

  async saveData(data: unknown): Promise<void> {
    this.data = data;
  }
}
