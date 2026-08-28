import { Component } from "./component";
import type { App, WorkspaceLeaf } from "./workspace";
import type { View } from "./view";
import type { TFile } from "./vault";

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
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: Editor, context: MarkdownFileInfo) => unknown;
  editorCheckCallback?: (
    checking: boolean,
    editor: Editor,
    context: MarkdownFileInfo,
  ) => boolean | void;
}

export interface Editor {
  getSelection(): string;
}

export interface MarkdownFileInfo {
  file: TFile | null;
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
  readonly ribbonIcons: HTMLElement[] = [];
  readonly settingTabs: PluginSettingTab[] = [];
  private data: unknown = null;

  constructor(
    public app: App,
    public manifest: PluginManifest = { id: "attest", name: "Attest", version: "0.0.0" },
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

  addRibbonIcon(
    icon: string,
    title: string,
    callback: (event: MouseEvent) => unknown,
  ): HTMLElement {
    const button = document.createElement("button");
    button.dataset.icon = icon;
    button.setAttribute("aria-label", title);
    button.setAttribute("title", title);
    button.addEventListener("click", callback);
    this.ribbonIcons.push(button);
    this.register(() => {
      button.removeEventListener("click", callback);
      const index = this.ribbonIcons.indexOf(button);
      if (index >= 0) this.ribbonIcons.splice(index, 1);
    });
    return button;
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
