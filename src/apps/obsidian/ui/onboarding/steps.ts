import { Setting } from "obsidian";

import { isVaultContainedFolder, ONBOARDING_SCOPES } from "@core/onboarding";
import type { OnboardingScope } from "@core/onboarding";
import { CUSTOM_SERVER_PRESET_ID } from "@core/agent";
import { IndexPathPickerModal } from "../settings/IndexPathPickerModal";
import { renderEndpointSection } from "./endpointSection";
import type { OnboardingStepContext } from "./types";

export function renderChatStep(containerEl: HTMLElement, ctx: OnboardingStepContext): void {
  renderHeading(containerEl, ctx, "onboarding.chat.title", "onboarding.chat.intro");
  renderEndpointSection(containerEl, ctx, { kind: "chat", endpoint: ctx.draft.chat });
}

/**
 * The branch point. Nothing is preselected: the three routes differ in how much
 * setup is left, so a default would silently commit most people to the longest
 * one.
 */
export function renderScopeStep(containerEl: HTMLElement, ctx: OnboardingStepContext): void {
  renderHeading(containerEl, ctx, "onboarding.scope.title", "onboarding.scope.intro");
  const choicesEl = containerEl.createDiv({ cls: "attest-onboarding__scope-choices" });
  for (const scope of ONBOARDING_SCOPES) {
    const choiceEl = choicesEl.createEl("label", {
      cls: "setting-item attest-onboarding__choice",
    });
    const controlEl = choiceEl.createDiv({ cls: "setting-item-control" });
    const checkbox = controlEl.createEl("input", {
      cls: "attest-onboarding__scope-checkbox",
      attr: {
        type: "checkbox",
        "aria-label": ctx.t(scopeNameKey(scope)),
      },
    });
    checkbox.checked = ctx.draft.scope === scope;
    checkbox.addEventListener("change", () => {
      if (!checkbox.checked && ctx.draft.scope === scope) {
        ctx.requestRender();
        return;
      }
      if (checkbox.checked) {
        ctx.draft.scope = scope;
        ctx.requestRender();
      }
    });
    const infoEl = choiceEl.createDiv({ cls: "setting-item-info" });
    infoEl.createDiv({ cls: "setting-item-name", text: ctx.t(scopeNameKey(scope)) });
    infoEl.createDiv({ cls: "setting-item-description", text: ctx.t(scopeDescKey(scope)) });
    choiceEl.createSpan({
      cls: "attest-onboarding__scope-remaining",
      text: ctx.t(remainingKey(scope)),
    });
    choiceEl.toggleClass("is-selected", ctx.draft.scope === scope);
  }
}

export function renderEmbeddingStep(containerEl: HTMLElement, ctx: OnboardingStepContext): void {
  renderHeading(containerEl, ctx, "onboarding.embedding.title", "onboarding.embedding.intro");

  new Setting(containerEl)
    .setName(ctx.t("onboarding.embedding.sameAsChat.name"))
    .setDesc(ctx.t("onboarding.embedding.sameAsChat.desc"))
    .addToggle((toggle) =>
      toggle.setValue(ctx.draft.embeddingSameAsChat).onChange((value) => {
        ctx.draft.embeddingSameAsChat = value;
        ctx.draft.embeddingVerified = false;
        if (!value) {
          resetEmbeddingEndpoint(ctx);
        }
        ctx.requestRender();
      }),
    );

  if (ctx.draft.embeddingSameAsChat) {
    syncEmbeddingWithChat(ctx);
  }

  renderEndpointSection(containerEl, ctx, {
    kind: "embedding",
    endpoint: ctx.draft.embedding,
    showEndpointFields: !ctx.draft.embeddingSameAsChat,
    previousProvider: ctx.draft.embeddingSameAsChat ? undefined : ctx.draft.chat.name,
    onModelChosen: () => ctx.probeEmbedding(),
  });

  containerEl.createDiv({
    cls: "attest-onboarding__note",
    text: ctx.t("onboarding.embedding.rebuildWarning"),
  });
}

export function renderFoldersStep(containerEl: HTMLElement, ctx: OnboardingStepContext): void {
  renderHeading(containerEl, ctx, "onboarding.folders.title", "onboarding.folders.intro");
  const index = ctx.draft.index;

  const foldersSetting = new Setting(containerEl)
    .setClass("attest-onboarding__folders-row")
    .setName(ctx.t("onboarding.folders.mode.name"))
    .setDesc(ctx.t("onboarding.folders.mode.desc"))
    .addDropdown((dropdown) =>
      dropdown
        .addOption("wholeVault", `${ctx.t("onboarding.folders.mode.wholeVault")} (/)`)
        .addOption("selected", ctx.t("onboarding.folders.mode.selected"))
        .setValue(index.mode)
        .onChange((value) => {
          index.mode = value === "selected" ? "selected" : "wholeVault";
          if (index.mode === "wholeVault") {
            index.includeFolders = ["/"];
          } else {
            index.excludeGlobs = [];
            if (index.includeFolders.join() === "/") {
              index.includeFolders = [];
            }
          }
          ctx.requestRender();
        }),
    );
  if (index.mode === "selected") {
    addPathPicker(
      foldersSetting,
      ctx,
      index.includeFolders,
      (paths) => {
        index.includeFolders = paths;
      },
      ctx.t("onboarding.folders.paths.action"),
    );
    renderSelectedPaths(containerEl, ctx, index.includeFolders, (paths) => {
      index.includeFolders = paths;
    });
  }

  if (index.mode === "wholeVault") {
    const excludedSetting = new Setting(containerEl)
      .setClass("attest-onboarding__folders-row")
      .setName(ctx.t("onboarding.folders.excluded.name"))
      .setDesc(ctx.t("onboarding.folders.excluded.desc"));
    excludedSetting.addText((text) =>
      text.setValue(index.excludeGlobs.join(", ")).onChange((value) => {
        index.excludeGlobs = parsePathList(value);
        ctx.refreshFooter();
      }),
    );
    addPathPicker(excludedSetting, ctx, index.excludeGlobs, (paths) => {
      index.excludeGlobs = paths;
    });
  }

  const locationSetting = new Setting(containerEl)
    .setClass("attest-onboarding__folders-row")
    .setName(ctx.t("onboarding.folders.location.name"));
  const describeLocation = (): void => {
    locationSetting.setDesc(
      isVaultContainedFolder(index.indexFolder)
        ? ctx.t("onboarding.folders.location.desc")
        : ctx.t("onboarding.folders.location.outsideVault"),
    );
  };
  describeLocation();
  locationSetting.addText((text) =>
    text.setValue(index.indexFolder).onChange((value) => {
      index.indexFolder = value.trim();
      describeLocation();
      ctx.refreshFooter();
    }),
  );
  if (ctx.isMobile) {
    containerEl.createDiv({
      cls: "attest-onboarding__warning",
      text: ctx.t("onboarding.folders.mobileWarning"),
    });
  }
}

/**
 * Shows what the picker selected. Without it the folders step gives no sign
 * that a choice was recorded, and the wizard looks unresponsive.
 */
function renderSelectedPaths(
  containerEl: HTMLElement,
  ctx: OnboardingStepContext,
  paths: string[],
  onChange: (paths: string[]) => void,
): void {
  const listEl = containerEl.createDiv({ cls: "attest-onboarding__selected-paths" });
  if (paths.length === 0) {
    listEl.createSpan({
      cls: "attest-onboarding__selected-empty",
      text: ctx.t("onboarding.folders.paths.empty"),
    });
    return;
  }

  for (const path of paths) {
    const chipEl = listEl.createSpan({ cls: "attest-onboarding__selected-path" });
    chipEl.createSpan({ cls: "attest-onboarding__selected-path-label", text: path });
    const removeEl = chipEl.createEl("button", {
      cls: "attest-onboarding__selected-path-remove",
      text: "×",
      attr: {
        type: "button",
        "aria-label": ctx.t("onboarding.folders.paths.remove", { path }),
      },
    });
    removeEl.addEventListener("click", () => {
      onChange(paths.filter((candidate) => candidate !== path));
      ctx.requestRender();
    });
  }
}

function addPathPicker(
  setting: Setting,
  ctx: OnboardingStepContext,
  selectedPaths: string[],
  onSubmit: (paths: string[]) => void,
  label = ctx.t("settings.indexProfileModal.choose"),
  pickerOptions: { foldersOnly?: boolean; singleSelection?: boolean } = {},
): void {
  setting.addButton((button) =>
    button.setButtonText(label).onClick(() => {
      new IndexPathPickerModal(ctx.app, {
        t: ctx.t,
        selectedPaths,
        ...pickerOptions,
        onSubmit: (paths) => {
          onSubmit(paths);
          ctx.requestRender();
        },
      }).open();
    }),
  );
}

function parsePathList(value: string): string[] {
  return value
    .split(/[\n,]/u)
    .map((path) => path.trim())
    .filter(Boolean);
}

/** Mirrors the chat endpoint so the shared-server case needs no second connection test. */
function syncEmbeddingWithChat(ctx: OnboardingStepContext): void {
  const { chat, embedding } = ctx.draft;
  embedding.presetId = chat.presetId;
  embedding.name = chat.name;
  embedding.apiFormat = chat.apiFormat;
  embedding.baseUrl = chat.baseUrl;
  embedding.apiKey = chat.apiKey;
  embedding.status = chat.status;
  embedding.message = chat.message;
  embedding.models = [...chat.models];
  if (
    embedding.models.length > 0 &&
    !embedding.models.some((model) => model.name === embedding.modelName)
  ) {
    embedding.modelName = "";
  }
}

function resetEmbeddingEndpoint(ctx: OnboardingStepContext): void {
  Object.assign(ctx.draft.embedding, {
    presetId: CUSTOM_SERVER_PRESET_ID,
    name: "",
    apiFormat: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    status: "idle",
    message: "",
    models: [],
    modelName: "",
  });
}

function renderHeading(
  containerEl: HTMLElement,
  ctx: OnboardingStepContext,
  titleKey: Parameters<OnboardingStepContext["t"]>[0],
  introKey: Parameters<OnboardingStepContext["t"]>[0],
): void {
  containerEl.createEl("h3", { text: ctx.t(titleKey) });
  containerEl.createDiv({ cls: "attest-onboarding__intro", text: ctx.t(introKey) });
}

function scopeNameKey(scope: OnboardingScope) {
  return `onboarding.scope.${scope}.name` as const;
}

function scopeDescKey(scope: OnboardingScope) {
  return `onboarding.scope.${scope}.desc` as const;
}

function remainingKey(scope: OnboardingScope) {
  return scope === "webOnly"
    ? ("onboarding.scope.remaining.none" as const)
    : ("onboarding.scope.remaining.two" as const);
}
