import type { Component } from "./component";
import type { App } from "./workspace";

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

export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests.");
}

export function setIcon(element: HTMLElement, icon: string): void {
  element?.setAttribute?.("data-icon", icon);
}
