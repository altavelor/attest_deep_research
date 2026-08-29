import { Menu, setIcon } from "obsidian";

export interface DropdownItem {
  id: string;
  name: string;
}

export interface MenuDropdownHandle {
  el: HTMLButtonElement;
  setValue(id: string): void;
  setDisabled(disabled: boolean): void;

  setItemDisabled(id: string, reason: string | undefined): void;
}

const MENU_CLASS = "attest-chat__menu";

/** Creates a compact label-and-caret button backed by an Obsidian DOM menu. */
export function createMenuDropdown(
  parentEl: HTMLElement,
  config: {
    cls: string;
    ariaLabel: string;
    placeholder: string;
    items: DropdownItem[];
    initialId: string;
    onSelect(id: string): void;
    menuCls?: string;
  },
): MenuDropdownHandle {
  const wrapEl = parentEl.createSpan({ cls: "attest-chat__dropdown-wrap" });
  const buttonEl = wrapEl.createEl("button", {
    cls: `attest-chat__dropdown ${config.cls}`,
    attr: { type: "button", "aria-label": config.ariaLabel },
  });
  const valueEl = buttonEl.createSpan({ cls: "attest-chat__dropdown-value" });
  const caretEl = buttonEl.createSpan({ cls: "attest-chat__dropdown-caret" });
  setIcon(caretEl, "chevron-down");

  let currentId = config.initialId;
  const disabledReasons = new Map<string, string>();
  const renderLabel = (): void => {
    const found = config.items.find((item) => item.id === currentId);
    valueEl.setText(found ? found.name : config.placeholder);
    buttonEl.setAttr("title", found ? found.name : config.placeholder);
  };
  renderLabel();

  buttonEl.addEventListener("click", () => {
    if (buttonEl.disabled) return;
    const menu = prepareMenu(new Menu(), config.menuCls);
    for (const item of config.items) {
      const reason = disabledReasons.get(item.id);
      menu.addItem((entry) => {
        entry
          .setTitle(reason ? `${item.name} — ${reason}` : item.name)
          .setChecked(item.id === currentId);
        if (reason) {
          entry.setDisabled(true);
          return;
        }
        entry.onClick(() => {
          currentId = item.id;
          renderLabel();
          config.onSelect(item.id);
        });
      });
    }
    const rect = buttonEl.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom });
    decorateShownMenu(menu, config.menuCls);
  });

  return {
    el: buttonEl,
    setValue: (id) => {
      currentId = id;
      renderLabel();
    },
    setDisabled: (disabled) => {
      buttonEl.disabled = disabled;
    },
    setItemDisabled: (id, reason) => {
      if (reason) {
        disabledReasons.set(id, reason);
      } else {
        disabledReasons.delete(id);
      }
    },
  };
}

export function showDropdownMenu(buttonEl: HTMLElement, configure: (menu: Menu) => void): void {
  const menu = prepareMenu(new Menu());
  configure(menu);
  const rect = buttonEl.getBoundingClientRect();
  menu.showAtPosition({ x: rect.left, y: rect.bottom });
  decorateShownMenu(menu);
}

/**
 * Styles the menu before it is placed. The width caps live in these classes, so
 * adding them after the menu is shown lets it be positioned against its
 * unconstrained width and land away from the button that opened it.
 */
function prepareMenu(menu: Menu, extraCls?: string): Menu {
  menu.setUseNativeMenu(false);
  decorateMenuEl((menu as unknown as { dom?: HTMLElement }).dom, extraCls);
  return menu;
}

function decorateShownMenu(menu: Menu, extraCls?: string): void {
  decorateMenuEl(
    (menu as unknown as { dom?: HTMLElement }).dom ??
      (Array.from(document.querySelectorAll(".menu")).pop() as HTMLElement | undefined),
    extraCls,
  );
}

function decorateMenuEl(menuEl: HTMLElement | undefined, extraCls?: string): void {
  menuEl?.addClass(MENU_CLASS);
  if (extraCls) {
    menuEl?.addClass(extraCls);
  }
}
