import type { App } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { DiscoveredModel, ModelDiscoveryResult, ServerProfile } from "@adapters/settings";
import type { OnboardingScope } from "@core/onboarding";

export type EndpointStatus = "idle" | "testing" | "ok" | "error";

export interface OnboardingEndpointDraft {
  presetId: string;
  name: string;
  apiFormat: ServerProfile["apiFormat"];
  baseUrl: string;
  apiKey: string;
  status: EndpointStatus;
  message: string;
  models: DiscoveredModel[];
  modelName: string;
}

export interface OnboardingDraft {
  chat: OnboardingEndpointDraft;
  scope?: OnboardingScope;
  embeddingSameAsChat: boolean;
  embedding: OnboardingEndpointDraft;
  embeddingVerified: boolean;
  index: {
    mode: "wholeVault" | "selected";
    indexFolder: string;
    includeFolders: string[];
    excludeGlobs: string[];
  };
}

export interface OnboardingStepContext {
  app: App;
  t: Translate;
  isMobile: boolean;
  draft: OnboardingDraft;
  serverFor(endpoint: OnboardingEndpointDraft): ServerProfile;
  fetchModels(server: ServerProfile): Promise<ModelDiscoveryResult>;
  requestRender(): void;
  refreshFooter(): void;
  isProbingEmbedding(): boolean;
  probeEmbedding(): void;
}
