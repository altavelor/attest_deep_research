import { Component, MarkdownRenderer } from "obsidian";

import type { ChainItem } from "@core/conversation";
import { FetchTargetAnimator } from "../fetchTargetAnimator";
import type { WorkflowRenderContext } from "./renderContext";
import { ToolOutputTextViewer } from "./toolOutputTextViewer";

/** Owns everything one timeline render allocates: Markdown components, DOM listeners, fetch-target timers and the inline output viewer. */
export class TimelineResources {
  private disposed = false;
  private readonly component = new Component();
  private readonly animator = new FetchTargetAnimator();
  private readonly listeners = new AbortController();
  private readonly viewer: ToolOutputTextViewer | undefined;

  constructor(private readonly context: WorkflowRenderContext) {
    context.markdownContext.addChild(this.component);
    this.viewer = context.outputViewerHost
      ? new ToolOutputTextViewer(context.outputViewerHost, context.t)
      : undefined;
  }

  get listenerSignal(): AbortSignal {
    return this.listeners.signal;
  }

  renderMarkdown(markdown: string, targetEl: HTMLElement): void {
    const stagingEl = targetEl.ownerDocument.createElement("div");
    const adopt = (): void => {
      if (this.disposed) return;
      while (stagingEl.firstChild) targetEl.appendChild(stagingEl.firstChild);
    };
    void MarkdownRenderer.render(this.context.app, markdown, stagingEl, "", this.component)
      .then(adopt)
      .catch(() => undefined);
    adopt();
  }

  animateFetchTargets(targetList: HTMLElement, targetElements: HTMLElement[]): void {
    if (!this.disposed) this.animator.start(targetList, targetElements);
  }

  openToolOutput(item: Extract<ChainItem, { kind: "tool-call" }>): void {
    if (this.viewer) this.viewer.open(item);
    else this.context.onOpenToolOutput(item);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animator.dispose();
    this.listeners.abort();
    this.viewer?.close();
    this.context.markdownContext.removeChild(this.component);
  }
}

export interface TimelineScope {
  scopeId: string;
  context: WorkflowRenderContext;
  resources: TimelineResources;
}
