import { App } from "obsidian";

import { IndexingState } from "@adapters/indexing";
import { FileSystemPort } from "@application/ports";
import { PdfTextCache } from "@adapters/extractors";
import { IxplorerSettings, PluginDebugLogger } from "@adapters/settings";
import type { UiTranslator } from "@adapters/i18n";
import { WebSourceHealthTracker } from "@application/web";
import { VaultWarmCaches } from "./VaultWarmCaches";

export interface CompositionContext {
  app: App;
  logger: PluginDebugLogger;
  translator: UiTranslator;
  pdfTextCache: PdfTextCache;
  webSourceHealth: WebSourceHealthTracker;
  warmCaches: VaultWarmCaches;
  fileSystem: FileSystemPort;
  getSettings(): IxplorerSettings;
  saveSettings(): Promise<void>;
  getIndexingState(profileId: string): IndexingState;
}
