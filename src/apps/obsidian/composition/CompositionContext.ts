import { App } from "obsidian";

import { IndexingState } from "@adapters/indexing";
import { PdfTextCache } from "@adapters/extractors";
import { IxplorerSettings, PluginDebugLogger } from "@adapters/settings";
import { WebSourceHealthTracker } from "@application/web";
import { VaultWarmCaches } from "./VaultWarmCaches";

export interface CompositionContext {
  app: App;
  logger: PluginDebugLogger;
  pdfTextCache: PdfTextCache;
  webSourceHealth: WebSourceHealthTracker;
  warmCaches: VaultWarmCaches;
  getSettings(): IxplorerSettings;
  saveSettings(): Promise<void>;
  getVaultLocalPath(path: string): string;
  getIndexingState(profileId: string): IndexingState;
}
