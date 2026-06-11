import { setIcon } from "obsidian";

export interface ModelDropdownOptions {
  inputEl: HTMLInputElement;
  containerEl: HTMLElement;
  getModels(): string[];
  onSelect(model: string): void | Promise<void>;
  emptyText?: string;
}

export function attachModelDropdown(options: ModelDropdownOptions): HTMLButtonElement {
  const wrapper = document.createElement("span");
  wrapper.className = "ixplorer-model-dropdown";
  options.inputEl.parentElement?.insertBefore(wrapper, options.inputEl);
  wrapper.appendChild(options.inputEl);

  const button = wrapper.createEl("button", {
    cls: "ixplorer-model-dropdown__button",
    attr: {
      type: "button",
      "aria-label": "Open model list",
      title: "Open model list",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
    },
  });
  setIcon(button, "chevron-down");

  const menu = wrapper.createDiv({
    cls: "ixplorer-model-dropdown__menu is-hidden",
    attr: { role: "listbox" },
  });

  const closeMenu = () => {
    menu.addClass("is-hidden");
    button.setAttr("aria-expanded", "false");
  };

  const openMenu = () => {
    renderMenu(menu, options, closeMenu);
    menu.removeClass("is-hidden");
    button.setAttr("aria-expanded", "true");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();

    if (menu.hasClass("is-hidden")) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target as Node)) {
      closeMenu();
    }
  });

  return button;
}

function renderMenu(menu: HTMLElement, options: ModelDropdownOptions, closeMenu: () => void): void {
  menu.empty();

  const models = options.getModels();
  if (models.length === 0) {
    menu.createDiv({
      cls: "ixplorer-model-dropdown__empty",
      text: options.emptyText ?? "No models loaded",
    });
    return;
  }

  for (const model of models) {
    const option = menu.createEl("button", {
      cls: "ixplorer-model-dropdown__option",
      text: model,
      attr: {
        type: "button",
        role: "option",
        "aria-selected": String(options.inputEl.value === model),
      },
    });
    option.addEventListener("click", () => {
      options.inputEl.value = model;
      options.inputEl.dispatchEvent(new Event("input"));
      options.inputEl.dispatchEvent(new Event("change"));
      void options.onSelect(model);
      closeMenu();
      options.inputEl.focus();
    });
  }
}
