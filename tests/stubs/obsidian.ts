export class TAbstractFile {
  constructor(public path: string) {}
}

export class TFile extends TAbstractFile {
  stat: { size: number; mtime: number; ctime: number };

  constructor(path: string, stat: { size?: number; mtime?: number } = {}) {
    super(path);
    this.stat = { size: stat.size ?? 0, mtime: stat.mtime ?? 0, ctime: 0 };
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export class FileSystemAdapter {
  constructor(private readonly basePath = "/vault") {}

  getBasePath(): string {
    return this.basePath;
  }
}

/** In-memory vault: holds the files a test declares and never touches disk. */
export class Vault {
  adapter: unknown = {};
  private files: TFile[] = [];

  setFiles(files: TFile[]): void {
    this.files = files;
  }

  useLocalPath(basePath: string): void {
    this.adapter = new FileSystemAdapter(basePath);
  }

  getFiles(): TFile[] {
    return this.files;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.find((file) => file.path === path) ?? null;
  }
}

export interface ViewState {
  type: string;
  active?: boolean;
}

/**
 * Executable stand-in for a workspace leaf: it instantiates the view through the
 * factory the plugin registered, so `setViewState` and `detach` drive the real
 * view lifecycle instead of a mock object.
 */
export class WorkspaceLeaf {
  view: View | null = null;

  constructor(public readonly workspace: Workspace) {}

  async setViewState(state: ViewState): Promise<void> {
    const factory = this.workspace.getViewFactory(state.type);
    if (!factory) throw new Error(`No view registered for type "${state.type}".`);
    this.view = factory(this);
    await this.view.onOpen();
  }

  async detach(): Promise<void> {
    await this.view?.onClose();
    this.view = null;
    this.workspace.removeLeaf(this);
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

type KeyHandler = (event: KeyboardEvent) => boolean | void;

export class Scope {
  private readonly handlers = new Map<string, KeyHandler>();

  register(_modifiers: string[], key: string, handler: KeyHandler): KeyHandler {
    this.handlers.set(key, handler);
    return handler;
  }

  unregister(handler: KeyHandler): void {
    for (const [key, registered] of this.handlers) {
      if (registered === handler) this.handlers.delete(key);
    }
  }

  handleKey(event: KeyboardEvent): void {
    this.handlers.get(event.key)?.(event);
  }
}

/**
 * Minimal executable stand-in for Obsidian's Modal: it owns real DOM nodes and
 * routes keydown events through the scope so keyboard behaviour can be tested.
 */
export class Modal {
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  scope = new Scope();

  constructor(public app: App) {
    this.containerEl = document.createElement("div");
    this.modalEl = this.containerEl.appendChild(document.createElement("div"));
    this.titleEl = this.modalEl.appendChild(document.createElement("div"));
    this.contentEl = this.modalEl.appendChild(document.createElement("div"));
    this.modalEl.addEventListener("keydown", (event) =>
      this.scope.handleKey(event as KeyboardEvent),
    );
  }

  open(): void {
    document.body.appendChild(this.containerEl);
    this.onOpen();
  }

  close(): void {
    this.onClose();
    this.containerEl.remove();
  }

  onOpen(): void {}

  onClose(): void {}
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

export class ToggleComponent {
  toggleEl: HTMLInputElement;
  private changeHandler?: (value: boolean) => unknown;

  constructor(containerEl: HTMLElement) {
    this.toggleEl = containerEl.appendChild(document.createElement("input"));
    this.toggleEl.type = "checkbox";
    this.toggleEl.addEventListener("click", () => {
      void this.changeHandler?.(this.toggleEl.checked);
    });
  }

  setValue(value: boolean): this {
    this.toggleEl.checked = value;
    return this;
  }

  getValue(): boolean {
    return this.toggleEl.checked;
  }

  setDisabled(disabled: boolean): this {
    this.toggleEl.disabled = disabled;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.toggleEl.setAttribute("aria-label", tooltip);
    return this;
  }

  onChange(handler: (value: boolean) => unknown): this {
    this.changeHandler = handler;
    return this;
  }
}

export class DropdownComponent {
  selectEl: HTMLSelectElement;
  private changeHandler?: (value: string) => unknown;

  constructor(containerEl: HTMLElement) {
    this.selectEl = containerEl.appendChild(document.createElement("select"));
    this.selectEl.addEventListener("change", () => {
      void this.changeHandler?.(this.selectEl.value);
    });
  }

  addOption(value: string, display: string): this {
    const option = this.selectEl.appendChild(document.createElement("option"));
    option.value = value;
    option.textContent = display;
    return this;
  }

  addOptions(options: Record<string, string>): this {
    for (const [value, display] of Object.entries(options)) this.addOption(value, display);
    return this;
  }

  setValue(value: string): this {
    this.selectEl.value = value;
    return this;
  }

  getValue(): string {
    return this.selectEl.value;
  }

  setDisabled(disabled: boolean): this {
    this.selectEl.disabled = disabled;
    return this;
  }

  onChange(handler: (value: string) => unknown): this {
    this.changeHandler = handler;
    return this;
  }

  selectOption(value: string): void {
    this.selectEl.value = value;
    this.selectEl.dispatchEvent(new Event("change"));
  }
}

export class TextComponent {
  inputEl: HTMLInputElement;
  private changeHandler?: (value: string) => unknown;

  constructor(containerEl: HTMLElement, type = "text") {
    this.inputEl = containerEl.appendChild(document.createElement("input"));
    this.inputEl.type = type;
    this.inputEl.addEventListener("input", () => {
      void this.changeHandler?.(this.inputEl.value);
    });
  }

  setValue(value: string): this {
    this.inputEl.value = value;
    return this;
  }

  getValue(): string {
    return this.inputEl.value;
  }

  setPlaceholder(placeholder: string): this {
    this.inputEl.placeholder = placeholder;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.inputEl.disabled = disabled;
    return this;
  }

  onChange(handler: (value: string) => unknown): this {
    this.changeHandler = handler;
    return this;
  }

  type(value: string): void {
    this.inputEl.value = value;
    this.inputEl.dispatchEvent(new Event("input"));
  }
}

export class SearchComponent extends TextComponent {
  constructor(containerEl: HTMLElement) {
    super(containerEl, "search");
  }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;

  constructor(containerEl: HTMLElement) {
    this.buttonEl = containerEl.appendChild(document.createElement("button"));
    this.buttonEl.type = "button";
  }

  setButtonText(text: string): this {
    this.buttonEl.textContent = text;
    return this;
  }

  setIcon(icon: string): this {
    setIcon(this.buttonEl, icon);
    return this;
  }

  setTooltip(tooltip: string): this {
    this.buttonEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setCta(): this {
    this.buttonEl.classList.add("mod-cta");
    return this;
  }

  setWarning(): this {
    this.buttonEl.classList.add("mod-warning");
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.buttonEl.disabled = disabled;
    return this;
  }

  onClick(handler: (event: MouseEvent) => unknown): this {
    this.buttonEl.addEventListener("click", (event) => {
      void handler(event as MouseEvent);
    });
    return this;
  }
}

export class Setting {
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.appendChild(document.createElement("div"));
    this.settingEl.className = "setting-item";
    this.nameEl = this.settingEl.appendChild(document.createElement("div"));
    this.descEl = this.settingEl.appendChild(document.createElement("div"));
    this.controlEl = this.settingEl.appendChild(document.createElement("div"));
  }

  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }

  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }

  setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }

  setClass(name: string): this {
    this.settingEl.classList.add(name);
    return this;
  }

  setTooltip(tooltip: string): this {
    this.settingEl.setAttribute("aria-label", tooltip);
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.settingEl.classList.toggle("is-disabled", disabled);
    return this;
  }

  addToggle(callback: (toggle: ToggleComponent) => unknown): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }

  addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
    callback(new DropdownComponent(this.controlEl));
    return this;
  }

  addText(callback: (text: TextComponent) => unknown): this {
    callback(new TextComponent(this.controlEl));
    return this;
  }

  addSearch(callback: (search: SearchComponent) => unknown): this {
    callback(new SearchComponent(this.controlEl));
    return this;
  }

  addButton(callback: (button: ButtonComponent) => unknown): this {
    callback(new ButtonComponent(this.controlEl));
    return this;
  }

  then(callback: (setting: this) => unknown): this {
    callback(this);
    return this;
  }
}

export type EventRef = { detach(): void };

/**
 * Component with the registration bookkeeping Obsidian performs: everything
 * passed to a `register*` method is released on `unload`, which is what makes
 * leak tests for views and plugins observable.
 */
export class Component {
  private readonly cleanups: (() => void)[] = [];
  private loaded = false;

  load(): void {
    this.loaded = true;
    this.onload();
  }

  unload(): void {
    this.loaded = false;
    while (this.cleanups.length > 0) this.cleanups.pop()?.();
    this.onunload();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  register(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  registerEvent(eventRef: EventRef): void {
    this.register(() => eventRef.detach());
  }

  registerInterval(id: number): number {
    this.register(() => window.clearInterval(id));
    return id;
  }

  registerDomEvent(
    element: HTMLElement | Window | Document,
    type: string,
    handler: EventListener,
  ): void {
    element.addEventListener(type, handler);
    this.register(() => element.removeEventListener(type, handler));
  }

  addChild<T extends Component>(child: T): T {
    this.register(() => child.unload());
    child.load();
    return child;
  }

  registrationCount(): number {
    return this.cleanups.length;
  }

  onload(): void {}

  onunload(): void {}
}

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
    this.register(() => this.app.workspace.unregisterViewFactory(type));
  }

  addCommand(command: Command): Command {
    this.commands.push(command);
    this.register(() => {
      const index = this.commands.indexOf(command);
      if (index >= 0) this.commands.splice(index, 1);
    });
    return command;
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

export class MenuItem {
  title = "";
  icon: string | undefined;
  checked = false;
  disabled = false;
  readonly itemEl: HTMLElement;
  private clickHandler: ((event: MouseEvent) => unknown) | undefined;

  constructor(containerEl: HTMLElement) {
    this.itemEl = containerEl.appendChild(document.createElement("div"));
    this.itemEl.className = "menu-item";
    this.itemEl.addEventListener("click", (event) => {
      if (this.disabled) return;
      void this.clickHandler?.(event as MouseEvent);
    });
  }

  setTitle(title: string): this {
    this.title = title;
    this.itemEl.textContent = title;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    this.itemEl.setAttribute("data-icon", icon);
    return this;
  }

  setChecked(checked: boolean): this {
    this.checked = checked;
    this.itemEl.setAttribute("aria-checked", String(checked));
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    this.itemEl.setAttribute("aria-disabled", String(disabled));
    return this;
  }

  onClick(handler: (event: MouseEvent) => unknown): this {
    this.clickHandler = handler;
    return this;
  }
}

/** DOM-backed menu: items are real nodes, so tests click them like a user. */
export class Menu {
  readonly dom: HTMLElement;
  readonly items: MenuItem[] = [];
  useNativeMenu = true;
  isShown = false;

  constructor() {
    this.dom = document.createElement("div");
    this.dom.className = "menu";
  }

  setUseNativeMenu(value: boolean): this {
    this.useNativeMenu = value;
    return this;
  }

  addItem(callback: (item: MenuItem) => unknown): this {
    const item = new MenuItem(this.dom);
    callback(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    this.dom.appendChild(document.createElement("hr"));
    return this;
  }

  showAtPosition(_position: { x: number; y: number }): this {
    document.body.appendChild(this.dom);
    this.isShown = true;
    return this;
  }

  hide(): this {
    this.dom.remove();
    this.isShown = false;
    return this;
  }
}

export const MarkdownRenderer = {
  async render(
    _app: App,
    markdown: string,
    element: HTMLElement,
    _sourcePath: string,
    _component: Component,
  ): Promise<void> {
    element.textContent = markdown;
  },
};

export class Notice {
  isHidden = false;

  constructor(public message: string) {
    shownNotices.push(this);
  }

  setMessage(message: string): this {
    this.message = message;
    return this;
  }

  hide(): void {
    this.isHidden = true;
  }
}

const shownNotices: Notice[] = [];

/** Notices raised since the last reset, so tests can assert user-facing messages. */
export function takeNotices(): Notice[] {
  return shownNotices.splice(0, shownNotices.length);
}

export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests.");
}

export function setIcon(element: HTMLElement, icon: string): void {
  element?.setAttribute?.("data-icon", icon);
}
