import { Vault, TFile } from "./vault";
import type { View } from "./view";

export interface ViewState {
  type: string;
  active?: boolean;
}

/**
 * Executable stand-in for a workspace leaf: it instantiates the view through the
 * factory the plugin registered and takes it through the full load/open and
 * close/unload lifecycle, so a view that leaks a registration is detectable.
 */
export class WorkspaceLeaf {
  view: View | null = null;

  constructor(public readonly workspace: Workspace) {}

  async setViewState(state: ViewState): Promise<void> {
    const factory = this.workspace.getViewFactory(state.type);
    if (!factory) throw new Error(`No view registered for type "${state.type}".`);
    await this.closeCurrentView();
    this.view = factory(this);
    this.view.load();
    await this.view.onOpen();
  }

  async detach(): Promise<void> {
    await this.closeCurrentView();
    this.workspace.removeLeaf(this);
  }

  private async closeCurrentView(): Promise<void> {
    const view = this.view;
    this.view = null;
    if (!view) return;
    await view.onClose();
    view.unload();
  }
}

export class Workspace {
  activeFile: TFile | null = null;
  readonly openedLinks: { target: string; sourcePath: string }[] = [];
  readonly revealedLeaves: WorkspaceLeaf[] = [];
  private readonly leaves: WorkspaceLeaf[] = [];
  private readonly viewFactories = new Map<string, (leaf: WorkspaceLeaf) => View>();

  constructor(public readonly app: App) {}

  registerViewFactory(type: string, factory: (leaf: WorkspaceLeaf) => View): void {
    this.viewFactories.set(type, factory);
  }

  unregisterViewFactory(type: string): void {
    this.viewFactories.delete(type);
  }

  getViewFactory(type: string): ((leaf: WorkspaceLeaf) => View) | undefined {
    return this.viewFactories.get(type);
  }

  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.view?.getViewType() === type);
  }

  getRightLeaf(_split: boolean): WorkspaceLeaf {
    return this.createLeaf();
  }

  getLeaf(_newLeaf?: boolean): WorkspaceLeaf {
    return this.createLeaf();
  }

  createLeaf(): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf(this);
    this.leaves.push(leaf);
    return leaf;
  }

  removeLeaf(leaf: WorkspaceLeaf): void {
    const index = this.leaves.indexOf(leaf);
    if (index >= 0) this.leaves.splice(index, 1);
  }

  getActiveFile(): TFile | null {
    return this.activeFile;
  }

  async revealLeaf(leaf: WorkspaceLeaf): Promise<void> {
    this.revealedLeaves.push(leaf);
  }

  async openLinkText(target: string, sourcePath: string, _newLeaf?: boolean): Promise<void> {
    this.openedLinks.push({ target, sourcePath });
  }
}

export class App {
  readonly vault = new Vault();
  readonly workspace = new Workspace(this);
}
