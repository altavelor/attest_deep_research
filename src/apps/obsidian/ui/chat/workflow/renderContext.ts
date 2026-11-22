import type { App, Component } from "obsidian";

import type { ChainItem } from "@core/conversation";
import type { Translate } from "@adapters/i18n";

export interface WorkflowRenderContext {
  app: App;
  markdownContext: Component;
  isDebugMode: boolean;
  t: Translate;
  onOpenToolOutput(item: Extract<ChainItem, { kind: "tool-call" }>): void;
  outputViewerHost?: HTMLElement;
  onOpenSubAgentSession?: (sessionId: string) => void;
}

export interface WorkflowUiState {
  openThinking: Set<string>;
  openOutputKey?: string;
}
