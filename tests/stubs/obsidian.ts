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

export class TFolder extends TAbstractFile {}

export class App {}

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

  onChange(handler: (value: boolean) => unknown): this {
    this.changeHandler = handler;
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

  addToggle(callback: (toggle: ToggleComponent) => unknown): this {
    callback(new ToggleComponent(this.controlEl));
    return this;
  }
}

export class Component {
  onload(): void {}

  onunload(): void {}
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
  constructor(public message: string) {}
}

export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests.");
}

export function setIcon(element: HTMLElement, icon: string): void {
  element?.setAttribute?.("data-icon", icon);
}
