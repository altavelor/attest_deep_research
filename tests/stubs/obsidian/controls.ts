import { setIcon } from "./dom";

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
