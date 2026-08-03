import { Component } from "./component";
import type { App, WorkspaceLeaf } from "./workspace";

export class View extends Component {
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  app: App;

  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app = leaf.workspace.app;
    this.containerEl = document.createElement("div");
    this.contentEl = this.containerEl.appendChild(document.createElement("div"));
  }

  getViewType(): string {
    return "";
  }

  getDisplayText(): string {
    return "";
  }

  getIcon(): string {
    return "";
  }

  async onOpen(): Promise<void> {}

  async onClose(): Promise<void> {}
}

export class ItemView extends View {}
