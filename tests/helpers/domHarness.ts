export interface ElementInit {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  type?: string;
  href?: string;
  value?: string;
  placeholder?: string;
  title?: string;
}

type AttrValue = string | number | boolean | null;

type Callback = (el: HTMLElement) => void;

type Creator = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  init?: ElementInit,
  callback?: (el: HTMLElementTagNameMap[K]) => void,
) => HTMLElementTagNameMap[K];

function applyInit(el: HTMLElement, init: ElementInit): void {
  if (init.cls) {
    const classes = Array.isArray(init.cls) ? init.cls : init.cls.split(/\s+/);
    el.classList.add(...classes.filter((name) => name.length > 0));
  }
  if (init.text !== undefined) el.textContent = init.text;
  for (const key of ["type", "href", "value", "placeholder", "title"] as const) {
    const value = init[key];
    if (value !== undefined) el.setAttribute(key, value);
  }
  for (const [name, value] of Object.entries(init.attr ?? {})) {
    if (value === null || value === false) continue;
    el.setAttribute(name, value === true ? "" : String(value));
  }
}

/**
 * Installs the Obsidian DOM helper methods on the happy-dom prototypes so UI
 * modules can be executed as-is in tests. Obsidian adds these to Element at
 * runtime; without them every renderer throws on its first createDiv call.
 */
export function installObsidianDomHelpers(): void {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.createEl === "function") return;

  const createEl: Creator = function createEl(this: Element, tag, init = {}, callback) {
    const el = this.ownerDocument.createElement(tag);
    applyInit(el, init);
    this.appendChild(el);
    callback?.(el);
    return el;
  };

  proto.createEl = createEl;

  proto.createDiv = function createDiv(this: Element, init?: ElementInit, callback?: Callback) {
    return createEl.call(this, "div", init, callback);
  };

  proto.createSpan = function createSpan(this: Element, init?: ElementInit, callback?: Callback) {
    return createEl.call(this, "span", init, callback);
  };

  proto.empty = function empty(this: Element) {
    while (this.firstChild) this.removeChild(this.firstChild);
  };

  proto.detach = function detach(this: Element) {
    this.remove();
  };

  proto.addClass = function addClass(this: Element, ...classes: string[]) {
    this.classList.add(...classes);
  };

  proto.removeClass = function removeClass(this: Element, ...classes: string[]) {
    this.classList.remove(...classes);
  };

  proto.toggleClass = function toggleClass(
    this: Element,
    classes: string | string[],
    value: boolean,
  ) {
    for (const name of Array.isArray(classes) ? classes : [classes]) {
      this.classList.toggle(name, value);
    }
  };

  proto.setText = function setText(this: Element, text: string) {
    this.textContent = text;
  };

  proto.setAttr = function setAttr(this: Element, name: string, value: AttrValue) {
    if (value === null || value === false) {
      this.removeAttribute(name);
      return;
    }
    this.setAttribute(name, value === true ? "" : String(value));
  };
}

/** Creates a detached-from-previous-test container attached to document.body. */
export function createContainer(): HTMLElement {
  installObsidianDomHelpers();
  const container = document.createElement("div");
  document.body.appendChild(container);
  return container;
}

export function resetDom(): void {
  document.body.innerHTML = "";
}
