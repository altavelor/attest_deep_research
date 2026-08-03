import type { App } from "./workspace";

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
