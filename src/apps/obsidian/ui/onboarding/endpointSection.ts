import { setIcon, Setting } from "obsidian";

import { CUSTOM_SERVER_PRESET_ID, findServerPreset, SERVER_PRESETS } from "@core/agent";
import { isMobileLocalProvider } from "@apps/obsidian/modelProviderRuntime";
import { toUserMessage } from "@core/errors";
import type { OnboardingEndpointDraft, OnboardingStepContext } from "./types";

const MENU_MARGIN = 8;
const MENU_MAX_HEIGHT = 224;
const MENU_MIN_HEIGHT = 96;

export interface EndpointSectionOptions {
  kind: "chat" | "embedding";
  onModelChosen?(modelName: string): void;
  endpoint: OnboardingEndpointDraft;
  showEndpointFields?: boolean;
  previousProvider?: string;
}

/**
 * Renders the provider, endpoint and model controls shared by the chat and
 * embedding steps. Nothing is written to settings here: the draft only gathers
 * what a later step turns into profiles.
 */
export function renderEndpointSection(
  containerEl: HTMLElement,
  ctx: OnboardingStepContext,
  options: EndpointSectionOptions,
): void {
  const { t } = ctx;
  const endpoint = options.endpoint;
  if (options.showEndpointFields === false) {
    renderModelControl(containerEl, ctx, options);
    return;
  }

  const providerSetting = new Setting(containerEl)
    .setName(t("onboarding.endpoint.provider.name"))
    .setDesc(
      options.kind === "chat"
        ? t("onboarding.endpoint.provider.chatDesc")
        : t("onboarding.endpoint.provider.embeddingDesc"),
    )
    .addDropdown((dropdown) => {
      dropdown.addOption(CUSTOM_SERVER_PRESET_ID, t("settings.serverModal.preset.custom"));
      for (const preset of SERVER_PRESETS) {
        dropdown.addOption(preset.id, preset.label);
      }
      dropdown.setValue(endpoint.presetId).onChange((value) => {
        applyPreset(endpoint, value);
        ctx.requestRender();
      });
    });
  if (options.previousProvider) {
    providerSetting.controlEl.createDiv({
      cls: "attest-onboarding__previous-provider",
      text: t("onboarding.embedding.previousProvider", { provider: options.previousProvider }),
    });
  }

  new Setting(containerEl)
    .setName(t("onboarding.endpoint.baseUrl.name"))
    .setDesc(t("onboarding.endpoint.baseUrl.desc"))
    .addText((text) =>
      text.setValue(endpoint.baseUrl).onChange((value) => {
        endpoint.baseUrl = value.trim();
        endpoint.presetId = CUSTOM_SERVER_PRESET_ID;
        resetDiscovery(endpoint);
        ctx.refreshFooter();
      }),
    );

  new Setting(containerEl)
    .setName(t("onboarding.endpoint.apiKey.name"))
    .setDesc(t("onboarding.endpoint.apiKey.desc"))
    .addText((text) => {
      text.inputEl.type = "password";
      text.setValue(endpoint.apiKey).onChange((value) => {
        endpoint.apiKey = value.trim();
        resetDiscovery(endpoint);
        ctx.refreshFooter();
      });
    });

  const unreachable = ctx.isMobile && isMobileLocalProvider(ctx.serverFor(endpoint));

  const connectionSetting = new Setting(containerEl)
    .setName(t("onboarding.endpoint.connection.name"))
    .setDesc(connectionDescription(ctx, endpoint, unreachable));
  connectionSetting.addButton((button) =>
    button
      .setButtonText(t("onboarding.endpoint.connection.action"))
      .setDisabled(endpoint.status === "testing" || unreachable || !endpoint.baseUrl)
      .onClick(() => {
        void discoverModels(ctx, endpoint);
      }),
  );
  renderConnectionStatus(connectionSetting.controlEl, ctx, endpoint);

  renderModelControl(containerEl, ctx, options);
}

function renderModelControl(
  containerEl: HTMLElement,
  ctx: OnboardingStepContext,
  options: EndpointSectionOptions,
): void {
  const { t } = ctx;
  const endpoint = options.endpoint;
  const models = availableModels(endpoint, options.kind);
  const modelSetting = new Setting(containerEl)
    .setName(
      options.kind === "chat"
        ? t("onboarding.endpoint.model.chatName")
        : t("onboarding.endpoint.model.embeddingName"),
    )
    .setDesc(
      models.length === 0
        ? t("onboarding.endpoint.model.empty")
        : t("onboarding.endpoint.model.desc", { count: models.length }),
    )
    .addText((text) => {
      text
        .setPlaceholder(t("onboarding.endpoint.model.placeholder"))
        .setValue(endpoint.modelName)
        .onChange((value) => {
          endpoint.modelName = value.trim();
          renderMenu();
          ctx.refreshFooter();
        });
      text.inputEl.addClass("attest-profile-modal__model-input");
      const anchorEl =
        text.inputEl.closest<HTMLElement>(".setting-item-control") ??
        text.inputEl.parentElement ??
        containerEl;
      const menuEl = anchorEl.createDiv({
        cls: "attest-profile-modal__model-menu attest-onboarding__model-menu is-hidden",
        attr: {
          id: `attest-onboarding-${options.kind}-model-menu`,
          role: "listbox",
        },
      });
      text.inputEl.setAttribute("role", "combobox");
      text.inputEl.setAttribute("aria-autocomplete", "list");
      text.inputEl.setAttribute("aria-controls", menuEl.id);
      text.inputEl.setAttribute("aria-expanded", "false");

      const closeMenu = (): void => {
        menuEl?.addClass("is-hidden");
        text.inputEl.setAttribute("aria-expanded", "false");
      };

      const renderMenu = (): void => {
        if (!menuEl) {
          return;
        }
        menuEl.empty();
        const query = text.inputEl.value.trim().toLocaleLowerCase();
        const matches = models.filter((model) => model.name.toLocaleLowerCase().includes(query));
        if (matches.length === 0) {
          menuEl.createDiv({
            cls: "attest-profile-modal__model-empty",
            text: t("settings.modelProfileModal.model.empty"),
          });
        } else {
          for (const model of matches) {
            const option = menuEl.createEl("button", {
              cls: "attest-profile-modal__model-option",
              text: model.name,
              attr: {
                type: "button",
                role: "option",
                title: model.name,
                "aria-selected": String(endpoint.modelName === model.name),
              },
            });
            option.addEventListener("click", () => {
              endpoint.modelName = model.name;
              text.inputEl.value = model.name;
              closeMenu();
              ctx.refreshFooter();
              options.onModelChosen?.(model.name);
            });
          }
        }
        fitMenuInsideDialog(text.inputEl, menuEl, containerEl);
        menuEl.removeClass("is-hidden");
        text.inputEl.setAttribute("aria-expanded", "true");
      };

      text.inputEl.addEventListener("focus", renderMenu);
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closeMenu();
        }
      });
      text.inputEl.parentElement?.addEventListener("focusout", (event) => {
        const next = event.relatedTarget;
        if (
          !(next instanceof Node) ||
          (!text.inputEl.parentElement?.contains(next) && !menuEl.contains(next))
        ) {
          closeMenu();
        }
      });
    });

  if (options.kind === "embedding" && ctx.isProbingEmbedding()) {
    renderModelProbe(modelSetting.controlEl, ctx);
  }
}

/** Marks the model as being tested while its capability probe is in flight. */
function renderModelProbe(controlEl: HTMLElement, ctx: OnboardingStepContext): void {
  const probeEl = controlEl.createDiv({
    cls: "attest-onboarding__model-probe",
    attr: { role: "status" },
  });
  probeEl.createSpan({
    cls: "attest-onboarding__model-probe-spinner",
    attr: { "aria-hidden": "true" },
  });
  probeEl.createSpan({
    cls: "attest-onboarding__model-probe-label",
    text: ctx.t("onboarding.endpoint.model.testing"),
  });
  controlEl.prepend(probeEl);
}

function renderConnectionStatus(
  controlEl: HTMLElement,
  ctx: OnboardingStepContext,
  endpoint: OnboardingEndpointDraft,
): void {
  if (endpoint.status !== "ok" && endpoint.status !== "error") {
    return;
  }
  const statusEl = controlEl.createSpan({
    cls: `attest-onboarding__connection-status is-${endpoint.status}`,
    attr: {
      "aria-label": connectionDescription(ctx, endpoint, false),
      title: connectionDescription(ctx, endpoint, false),
    },
  });
  setIcon(statusEl, endpoint.status === "ok" ? "check" : "x");
  controlEl.prepend(statusEl);
}

export function availableModels(endpoint: OnboardingEndpointDraft, kind: "chat" | "embedding") {
  return endpoint.models.filter((model) =>
    kind === "chat" ? model.capabilities.chat : model.capabilities.embeddings,
  );
}

function connectionDescription(
  ctx: OnboardingStepContext,
  endpoint: OnboardingEndpointDraft,
  unreachable: boolean,
): string {
  if (unreachable) {
    return ctx.t("onboarding.endpoint.connection.mobileLocal");
  }

  switch (endpoint.status) {
    case "testing":
      return ctx.t("onboarding.endpoint.connection.testing");
    case "ok":
    case "error":
      return endpoint.message;
    default:
      return ctx.t("onboarding.endpoint.connection.desc");
  }
}

/**
 * Loads the model list for the endpoint as it stands when the button is
 * pressed. An edit made while the request is in flight discards the answer, so
 * a list can never be attributed to an endpoint it did not come from.
 */
async function discoverModels(
  ctx: OnboardingStepContext,
  endpoint: OnboardingEndpointDraft,
): Promise<void> {
  const requested = endpointIdentity(endpoint);
  endpoint.status = "testing";
  endpoint.message = "";
  ctx.requestRender();
  let result;
  try {
    result = await ctx.fetchModels(ctx.serverFor(endpoint));
  } catch (error) {
    if (endpointIdentity(endpoint) !== requested) {
      return;
    }
    endpoint.status = "error";
    endpoint.message = toUserMessage(error);
    endpoint.models = [];
    endpoint.modelName = "";
    ctx.requestRender();
    return;
  }
  if (endpointIdentity(endpoint) !== requested) {
    return;
  }

  endpoint.status = result.ok ? "ok" : "error";
  endpoint.message = result.message;
  endpoint.models = result.ok ? result.models : [];
  if (!endpoint.models.some((model) => model.name === endpoint.modelName)) {
    endpoint.modelName = "";
  }
  ctx.requestRender();
}

function applyPreset(endpoint: OnboardingEndpointDraft, presetId: string): void {
  const previousLabel = findServerPreset(endpoint.presetId)?.label;
  endpoint.presetId = presetId;
  resetDiscovery(endpoint);
  const preset = findServerPreset(presetId);
  if (!preset) {
    return;
  }

  endpoint.baseUrl = preset.baseUrl;
  endpoint.apiFormat = preset.apiFormat;
  if (!endpoint.name || endpoint.name === previousLabel) {
    endpoint.name = preset.label;
  }
}

function endpointIdentity(endpoint: OnboardingEndpointDraft): string {
  return `${endpoint.apiFormat}|${endpoint.baseUrl}|${endpoint.apiKey}`;
}

function resetDiscovery(endpoint: OnboardingEndpointDraft): void {
  endpoint.status = "idle";
  endpoint.message = "";
  endpoint.models = [];
  endpoint.modelName = "";
}

/**
 * Keeps the model list inside the dialog. The field can be the last row, where
 * a list opening downwards is cut off by the dialog edge, so the menu flips
 * above the field when there is more room there and is capped to what fits.
 */
function fitMenuInsideDialog(
  inputEl: HTMLElement,
  menuEl: HTMLElement,
  fallbackEl: HTMLElement,
): void {
  const boundsEl = inputEl.closest<HTMLElement>(".modal-content") ?? fallbackEl;
  const bounds = boundsEl.getBoundingClientRect();
  const anchor = inputEl.getBoundingClientRect();
  const spaceBelow = Math.max(0, bounds.bottom - anchor.bottom - MENU_MARGIN);
  const spaceAbove = Math.max(0, anchor.top - bounds.top - MENU_MARGIN);
  const openAbove = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
  const available = openAbove ? spaceAbove : spaceBelow;
  menuEl.toggleClass("is-above", openAbove);
  menuEl.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, available))}px`;
}
