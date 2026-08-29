import { App, Modal, Notice, Setting } from "obsidian";

import type { Translate } from "@adapters/i18n";
import { CUSTOM_SERVER_PRESET_ID, matchServerPreset } from "@core/agent";
import type { TextDirection } from "@core/i18n";
import {
  isVaultContainedFolder,
  nextStep,
  previousStep,
  scopeNeedsIndex,
  stepPosition,
  stepsForScope,
} from "@core/onboarding";
import type { OnboardingStep } from "@core/onboarding";
import { DEFAULT_INDEX_PROFILE } from "@adapters/settings";
import type {
  AppliedOnboarding,
  ModelDiscoveryResult,
  OnboardingEndpointPrefill,
  OnboardingPrefill,
  OnboardingResult,
  ServerProfile,
} from "@adapters/settings";
import { toUserMessage } from "@core/errors";
import { isMobileLocalProvider } from "@apps/obsidian/modelProviderRuntime";
import type { IndexingState } from "@adapters/indexing";
import { availableModels } from "./endpointSection";
import { renderChatStep, renderEmbeddingStep, renderFoldersStep, renderScopeStep } from "./steps";
import type { OnboardingDraft, OnboardingEndpointDraft, OnboardingStepContext } from "./types";

export interface OnboardingModalOptions {
  t: Translate;
  getDirection?(): TextDirection;
  isMobile: boolean;
  prefill?: OnboardingPrefill;
  fetchModels(server: ServerProfile): Promise<ModelDiscoveryResult>;
  verifyEmbedding(server: ServerProfile, modelName: string): Promise<boolean>;
  onComplete(result: OnboardingResult): Promise<AppliedOnboarding>;
  onStartIndexing(indexProfileId: string, embeddingModelProfileId: string): void;
  watchIndexing?(indexProfileId: string, listener: (state: IndexingState) => void): () => void;
  onOpenChat(): Promise<void>;
  onSkip(): Promise<void>;
}

/**
 * First-run wizard. It gathers a chat model, the answer scope and, when the
 * scope needs the vault, an embedding model and the folders to index. Nothing
 * reaches settings until the final step succeeds, so an abandoned run leaves no
 * half-built profiles behind.
 */
export class OnboardingModal extends Modal {
  private step: OnboardingStep = "chat";
  private finished = false;
  private applying = false;
  private closed = false;
  private embeddingFailed = false;
  private embeddingVerifiedFor: string | null = null;
  private embeddingProbing = false;
  private applied?: AppliedOnboarding;
  private unwatchIndexing: (() => void) | null = null;
  private indexingState?: IndexingState;
  private indexingStarted = false;
  private bodyEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private readonly draft: OnboardingDraft = {
    chat: createEndpointDraft(),
    embeddingSameAsChat: true,
    embedding: createEndpointDraft(),
    embeddingVerified: false,
    index: {
      mode: "wholeVault",
      indexFolder: DEFAULT_INDEX_PROFILE.indexFolder,
      includeFolders: [...DEFAULT_INDEX_PROFILE.includeFolders],
      excludeGlobs: [...DEFAULT_INDEX_PROFILE.excludeGlobs],
    },
  };

  constructor(
    app: App,
    private readonly options: OnboardingModalOptions,
  ) {
    super(app);
    this.applyPrefill(options.prefill);
  }

  /**
   * Opens a re-run on the setup the wizard already produced. Discovered model
   * lists are not part of it: the endpoint is only reachable once the user tests
   * the connection again, and a stale list would suggest otherwise.
   */
  private applyPrefill(prefill?: OnboardingPrefill): void {
    if (!prefill) {
      return;
    }

    applyEndpointPrefill(this.draft.chat, prefill.chat);
    applyEndpointPrefill(this.draft.embedding, prefill.embedding ?? prefill.chat);
    this.draft.embeddingSameAsChat = prefill.embeddingSameAsChat;
    if (prefill.index) {
      this.draft.index = {
        mode: prefill.index.mode,
        indexFolder: prefill.index.indexFolder || DEFAULT_INDEX_PROFILE.indexFolder,
        includeFolders: [...prefill.index.includeFolders],
        excludeGlobs: [...prefill.index.excludeGlobs],
      };
    }
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    this.contentEl.addClass("attest-profile-modal");
    this.contentEl.addClass("attest-onboarding");
    this.render();
  }

  onClose(): void {
    this.closed = true;
    this.unwatchIndexing?.();
    this.unwatchIndexing = null;
    this.bodyEl = null;
    this.footerEl = null;
    this.contentEl.empty();
  }

  private render(): void {
    if (this.closed) {
      return;
    }

    const { contentEl } = this;
    const { t } = this.options;
    contentEl.empty();
    contentEl.createEl("h2", { text: t("onboarding.title") });
    this.bodyEl = contentEl.createDiv({ cls: "attest-onboarding__body" });
    this.footerEl = contentEl.createDiv({ cls: "attest-onboarding__footer" });

    if (this.finished) {
      this.renderFinish(this.bodyEl);
    } else {
      this.renderStep(this.bodyEl);
    }
    this.renderFooter();
  }

  private renderStep(containerEl: HTMLElement): void {
    const ctx = this.stepContext();
    switch (this.step) {
      case "chat":
        renderChatStep(containerEl, ctx);
        return;
      case "scope":
        renderScopeStep(containerEl, ctx);
        return;
      case "embedding":
        renderEmbeddingStep(containerEl, ctx);
        return;
      case "folders":
        renderFoldersStep(containerEl, ctx);
    }
  }

  /**
   * Both arrivals are real finishes. The web-only route is not a degraded
   * setup, so it gets its own title and profile summary rather than an empty
   * version of the indexing screen.
   */
  private renderFinish(containerEl: HTMLElement): void {
    const { t } = this.options;
    const indexing = this.applied?.indexProfileId !== undefined;

    const outcome = this.indexingOutcome();
    const header = containerEl.createDiv({ cls: "attest-onboarding__finish-header" });
    header.createEl("h3", {
      cls: "attest-onboarding__finish-title",
      text: indexing ? t(FINISH_TITLES[outcome]) : t("onboarding.finish.web.title"),
    });
    header.createDiv({
      cls: `attest-onboarding__finish-status is-${outcome}`,
      text: indexing ? t(FINISH_STATUSES[outcome]) : t("onboarding.finish.web.status"),
    });

    containerEl.createDiv({
      cls: "attest-onboarding__intro",
      text: indexing ? t(FINISH_INTROS[outcome]) : t("onboarding.finish.webIntro"),
    });

    if (indexing) {
      this.renderFinishProgress(containerEl);
    }

    const tags = containerEl.createDiv({ cls: "attest-onboarding__finish-tags" });
    const labels = indexing
      ? ([
          "onboarding.finish.tag.server",
          "onboarding.finish.tag.chat",
          "onboarding.finish.tag.embedding",
          "onboarding.finish.tag.index",
        ] as const)
      : (["onboarding.finish.tag.server", "onboarding.finish.tag.chat"] as const);
    for (const label of labels) {
      tags.createSpan({ cls: "attest-onboarding__finish-tag", text: t(label) });
    }
  }

  /**
   * Distinguishes a run still going from one that ended. The first state can
   * arrive before the run starts, so nothing counts as finished until indexing
   * was observed at least once.
   */
  private indexingOutcome(): IndexingOutcome {
    const state = this.indexingState;
    if (!state || !this.indexingStarted || state.status === "indexing") {
      return "running";
    }
    return state.status === "error" ? "error" : "done";
  }

  private renderFinishProgress(containerEl: HTMLElement): void {
    const { t } = this.options;
    const state = this.indexingState;
    const percent = Math.round(Math.min(Math.max(state?.progress ?? 0, 0), 1) * 100);
    const bar = containerEl.createDiv({
      cls: "attest-onboarding__finish-progress",
      attr: {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(percent),
      },
    });
    const value = bar.createDiv({ cls: "attest-onboarding__finish-progress-value" });
    value.style.width = `${percent}%`;

    containerEl.createDiv({
      cls: "attest-onboarding__finish-stats",
      text:
        state?.status === "error" && state.errorMessage
          ? state.errorMessage
          : state
            ? indexingStats(t, state)
            : t("onboarding.finish.indexingStarting"),
    });
  }

  private renderFooter(): void {
    const footerEl = this.footerEl;
    if (this.closed || !footerEl) {
      return;
    }
    footerEl.empty();
    const { t } = this.options;

    if (this.finished) {
      const finishBar = footerEl.createDiv({ cls: "attest-onboarding__footer-bar" });
      const dismissLabel = this.dismissLabel();
      if (dismissLabel) {
        createFooterButton(finishBar, dismissLabel, () => this.close());
      }
      createFooterButton(
        finishBar,
        t("onboarding.action.openChat"),
        () => {
          void this.options.onOpenChat().catch((error) => new Notice(toUserMessage(error)));
          this.close();
        },
        { cta: true },
      );
      return;
    }

    const position = stepPosition(this.draft.scope, this.step);
    const total = stepsForScope(this.draft.scope).length;

    if (this.embeddingFailed && this.step === "embedding") {
      footerEl.createDiv({
        cls: "attest-onboarding__warning",
        text: t("onboarding.embedding.unverified"),
      });
      new Setting(footerEl).setClass("attest-profile-modal__actions").addButton((button) =>
        button.setButtonText(t("onboarding.embedding.useWebInstead")).onClick(() => {
          this.draft.scope = "webOnly";
          void this.finish();
        }),
      );
    }

    const footerBar = footerEl.createDiv({ cls: "attest-onboarding__footer-bar" });
    const back = previousStep(this.draft.scope, this.step);
    createFooterButton(
      footerBar,
      back ? t("onboarding.action.back") : t("onboarding.action.skip"),
      () => {
        if (back) {
          this.step = back;
          this.render();
          return;
        }
        void this.skip();
      },
    );

    const trailing = footerBar.createDiv({ cls: "attest-onboarding__footer-trailing" });
    if (this.step === "scope" && this.draft.scope === undefined) {
      trailing.createSpan({
        cls: "attest-onboarding__footer-hint",
        text: t("onboarding.scope.pickOne"),
      });
    }
    const steps = trailing.createDiv({ cls: "attest-onboarding__steps" });
    steps.setAttribute("role", "img");
    steps.setAttribute("aria-label", t("onboarding.progress", { step: position, total }));
    for (let step = 1; step <= total; step += 1) {
      steps.createSpan({
        cls: `attest-onboarding__step-dot${step <= position ? " is-complete" : ""}`,
      });
    }
    createFooterButton(trailing, this.primaryLabel(), () => void this.advance(), {
      cta: true,
      disabled: !this.canAdvance() || this.applying,
    });
  }

  /**
   * Names the dismissing action, or nothing when there is none to offer. A run
   * that already ended cannot be kept in the background, and the dialog's own
   * close control still dismisses it.
   */
  private dismissLabel(): string {
    const { t } = this.options;
    if (this.applied?.indexProfileId === undefined) {
      return t("onboarding.action.addVaultLater");
    }
    return this.indexingOutcome() === "running" ? t("onboarding.action.keepIndexing") : "";
  }

  private primaryLabel(): string {
    const { t } = this.options;
    if (this.applying && !this.embeddingProbing) {
      return t("onboarding.action.checking");
    }

    if (nextStep(this.draft.scope, this.step)) {
      return t("onboarding.action.continue");
    }
    return this.draft.scope !== undefined && scopeNeedsIndex(this.draft.scope)
      ? t("onboarding.action.startIndexing")
      : t("onboarding.action.finish");
  }

  /**
   * An endpoint the wizard may turn into a profile. A local provider on mobile
   * is refused here as well as at the connection test, so the run cannot end
   * with a profile that is unreachable by construction.
   */
  private isUsableEndpoint(endpoint: OnboardingEndpointDraft): boolean {
    if (!endpoint.baseUrl || !endpoint.modelName) {
      return false;
    }

    return !(this.options.isMobile && isMobileLocalProvider(this.serverFor(endpoint)));
  }

  private canAdvance(): boolean {
    switch (this.step) {
      case "chat":
        return this.isUsableEndpoint(this.draft.chat);
      case "scope":
        return this.draft.scope !== undefined;
      case "embedding":
        return !this.embeddingProbing && this.isUsableEndpoint(this.draft.embedding);
      case "folders":
        return (
          Boolean(this.draft.index.indexFolder) &&
          isVaultContainedFolder(this.draft.index.indexFolder) &&
          (this.draft.index.mode === "wholeVault" || this.draft.index.includeFolders.length > 0)
        );
    }
  }

  private async advance(): Promise<void> {
    if (this.step === "embedding" && !(await this.verifyEmbedding())) {
      return;
    }

    const following = nextStep(this.draft.scope, this.step);
    if (following) {
      this.step = following;
      this.render();
      return;
    }

    await this.finish();
  }

  /**
   * Starts the capability probe as soon as a model is picked, so the wait
   * happens while the step is still on screen rather than after Continue. The
   * step shows it as testing and refuses to advance until it answers.
   */
  private probeEmbedding(): void {
    if (this.embeddingProbing) {
      return;
    }

    this.embeddingProbing = true;
    this.render();
    void this.verifyEmbedding().finally(() => {
      this.embeddingProbing = false;
      if (!this.closed) {
        this.render();
      }
    });
  }

  /**
   * Confirms the embedding model with one real request before it becomes a
   * profile. A failure is not a dead end: the chat model already works, so the
   * step offers the web-only finish instead of blocking.
   */
  private async verifyEmbedding(): Promise<boolean> {
    const endpoint = endpointIdentity(this.draft.embedding);
    const modelName = this.draft.embedding.modelName;
    const probeKey = `${endpoint}|${modelName}`;
    if (this.embeddingVerifiedFor === probeKey) {
      return true;
    }

    this.applying = true;
    this.renderFooter();
    let verified = false;
    try {
      verified = await this.options.verifyEmbedding(
        this.serverFor(this.draft.embedding),
        this.draft.embedding.modelName,
      );
    } catch {
      verified = false;
    }
    this.applying = false;
    if (this.closed) {
      return false;
    }
    if (
      endpointIdentity(this.draft.embedding) !== endpoint ||
      this.draft.embedding.modelName !== modelName
    ) {
      this.embeddingFailed = false;
      this.renderFooter();
      return false;
    }

    this.draft.embeddingVerified = verified;
    this.embeddingVerifiedFor = verified ? probeKey : null;
    this.embeddingFailed = !verified;
    if (!verified) {
      this.render();
    }
    return verified;
  }

  private async finish(): Promise<void> {
    if (this.applying || this.finished) {
      return;
    }

    this.applying = true;
    this.renderFooter();
    try {
      this.applied = await this.options.onComplete(this.buildResult());
    } catch (error) {
      new Notice(toUserMessage(error));
      this.applying = false;
      this.renderFooter();
      return;
    }
    this.applying = false;
    if (this.closed) {
      return;
    }
    this.finished = true;
    this.render();
    this.startIndexing();
  }

  private async skip(): Promise<void> {
    if (this.applying) {
      return;
    }
    this.applying = true;
    this.renderFooter();
    try {
      await this.options.onSkip();
    } catch (error) {
      new Notice(toUserMessage(error));
      this.applying = false;
      this.renderFooter();
      return;
    }
    this.close();
  }

  private startIndexing(): void {
    const indexProfileId = this.applied?.indexProfileId;
    const embeddingModelProfileId = this.applied?.embeddingModelProfileId;
    if (!indexProfileId || !embeddingModelProfileId) {
      return;
    }

    this.unwatchIndexing =
      this.options.watchIndexing?.(indexProfileId, (state) => {
        this.indexingState = state;
        if (state.status === "indexing") {
          this.indexingStarted = true;
        }
        if (this.finished && this.bodyEl) {
          this.bodyEl.empty();
          this.renderFinish(this.bodyEl);
          this.renderFooter();
        }
      }) ?? null;
    this.options.onStartIndexing(indexProfileId, embeddingModelProfileId);
  }

  private buildResult(): OnboardingResult {
    const scope = this.draft.scope ?? "webOnly";
    const chatModel = availableModels(this.draft.chat, "chat").find(
      (model) => model.name === this.draft.chat.modelName,
    );
    const result: OnboardingResult = {
      scope,
      chat: {
        server: endpointToServerDraft(this.draft.chat),
        modelName: this.draft.chat.modelName,
        capabilities: chatModel?.capabilities,
        capabilitySnapshot: chatModel?.capabilitySnapshot,
      },
    };

    if (!scopeNeedsIndex(scope)) {
      return result;
    }

    const embeddingModel = availableModels(this.draft.embedding, "embedding").find(
      (model) => model.name === this.draft.embedding.modelName,
    );
    result.embedding = {
      server: endpointToServerDraft(this.draft.embedding),
      modelName: this.draft.embedding.modelName,
      capabilities: embeddingModel?.capabilities,
      verified: this.draft.embeddingVerified,
    };
    result.index = {
      ...this.draft.index,
      includeFolders: [...this.draft.index.includeFolders],
      excludeGlobs: [...this.draft.index.excludeGlobs],
    };
    return result;
  }

  private stepContext(): OnboardingStepContext {
    return {
      app: this.app,
      t: this.options.t,
      isMobile: this.options.isMobile,
      draft: this.draft,
      serverFor: (endpoint) => this.serverFor(endpoint),
      fetchModels: (server) => this.options.fetchModels(server),
      requestRender: () => this.render(),
      refreshFooter: () => this.renderFooter(),
      isProbingEmbedding: () => this.embeddingProbing,
      probeEmbedding: () => this.probeEmbedding(),
    };
  }

  private serverFor(endpoint: OnboardingEndpointDraft): ServerProfile {
    const now = new Date().toISOString();
    return {
      id: "onboarding-draft",
      name: endpoint.name || endpoint.baseUrl,
      apiFormat: endpoint.apiFormat,
      baseUrl: endpoint.baseUrl,
      ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
      createdAt: now,
      updatedAt: now,
    };
  }
}

type IndexingOutcome = "running" | "done" | "error";

const FINISH_TITLES = {
  running: "onboarding.finish.vault.title",
  done: "onboarding.finish.vault.doneTitle",
  error: "onboarding.finish.vault.errorTitle",
} as const;

const FINISH_STATUSES = {
  running: "onboarding.finish.vault.status",
  done: "onboarding.finish.vault.doneStatus",
  error: "onboarding.finish.vault.errorStatus",
} as const;

const FINISH_INTROS = {
  running: "onboarding.finish.vaultIntro",
  done: "onboarding.finish.vaultDoneIntro",
  error: "onboarding.finish.vaultErrorIntro",
} as const;

/** Reports index progress in whichever unit the run already knows. */
function indexingStats(t: Translate, state: IndexingState): string {
  if (state.chunksTotal !== undefined && state.chunksTotal > 0) {
    return t("onboarding.finish.stats.chunks", {
      embedded: state.chunksEmbedded ?? 0,
      total: state.chunksTotal,
    });
  }

  return t("onboarding.finish.stats.files", {
    scanned: state.scannedFiles,
    total: state.totalFiles,
  });
}

function createFooterButton(
  containerEl: HTMLElement,
  label: string,
  onClick: () => void,
  options: { cta?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const button = containerEl.createEl("button", { text: label });
  button.classList.toggle("mod-cta", options.cta === true);
  button.disabled = options.disabled === true;
  button.addEventListener("click", onClick);
  return button;
}

function endpointIdentity(endpoint: OnboardingEndpointDraft): string {
  return `${endpoint.apiFormat}|${endpoint.baseUrl}|${endpoint.apiKey ?? ""}`;
}

function createEndpointDraft(): OnboardingEndpointDraft {
  return {
    presetId: CUSTOM_SERVER_PRESET_ID,
    name: "",
    apiFormat: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    status: "idle",
    message: "",
    models: [],
    modelName: "",
  };
}

function applyEndpointPrefill(
  endpoint: OnboardingEndpointDraft,
  prefill: OnboardingEndpointPrefill | undefined,
): void {
  if (!prefill) {
    return;
  }

  endpoint.presetId = matchServerPreset(prefill.server.baseUrl)?.id ?? CUSTOM_SERVER_PRESET_ID;
  endpoint.name = prefill.server.name;
  endpoint.apiFormat = prefill.server.apiFormat;
  endpoint.baseUrl = prefill.server.baseUrl;
  endpoint.apiKey = prefill.server.apiKey ?? "";
  endpoint.modelName = prefill.modelName;
}

function endpointToServerDraft(endpoint: OnboardingEndpointDraft) {
  return {
    name: endpoint.name || endpoint.baseUrl,
    apiFormat: endpoint.apiFormat,
    baseUrl: endpoint.baseUrl,
    ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
  };
}
