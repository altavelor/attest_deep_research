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
