import { App } from "obsidian";

import {
  areCredentialsComplete,
  isWebSourceActive,
  WEB_SOURCE_CATALOG,
  WebSourceActivation,
  WebSourceCategory,
  WebSourceDescriptor,
} from "@core/web";
import { AttestSettings } from "@adapters/settings";
import { getWebSourceProfile, upsertWebSourceProfile } from "@adapters/settings";
import type { WebSourceIssue } from "@application/web";
import type { MessageKey, Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { createIconButton } from "./shared";
import { WebSourceModal } from "./WebSourceModal";

export interface WebSourcesSectionContext {
  app: App;
  t: Translate;
  getDirection?(): TextDirection;
  getSettings(): AttestSettings;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;

  getSourceIssue(sourceId: string): WebSourceIssue | undefined;

  resetSourceIssue(sourceId: string): void;
}

const CATEGORY_MESSAGE_KEYS: Record<WebSourceCategory, MessageKey> = {
  serp: "settings.webSources.category.serp",
  neural: "settings.webSources.category.neural",
  academic: "settings.webSources.category.academic",
  encyclopedia: "settings.webSources.category.encyclopedia",
  community: "settings.webSources.category.community",
  news: "settings.webSources.category.news",
  fetch: "settings.webSources.category.fetch",
  image: "settings.webSources.category.image",
};

const ACTIVATION_MESSAGE_KEYS: Record<WebSourceActivation, MessageKey> = {
  off: "settings.webSources.activation.off",
  auto: "settings.webSources.activation.auto",
  always: "settings.webSources.activation.always",
};

const ISSUE_MESSAGE_KEYS: Record<WebSourceIssue["reason"], MessageKey> = {
  unauthorized: "settings.webSources.issue.unauthorized",
  "rate-limited": "settings.webSources.issue.rateLimited",
};

/**
 * "External sources" hub list. Rows are fixed by the catalog: sources are
 * configured and toggled, never added or deleted. Unconfigured sources show a
 * "Set up…" action; configured ones show a status lamp that cycles off → auto →
 * always (grey — off, green — auto, ringed green — always, yellow — a runtime
 * problem).
 */
export class WebSourcesSection {
  constructor(private readonly ctx: WebSourcesSectionContext) {}

  render(containerEl: HTMLElement): void {
    const { t } = this.ctx;
    const settings = this.ctx.getSettings();
    const enabledTotal = WEB_SOURCE_CATALOG.filter((descriptor) =>
      isWebSourceActive(getWebSourceProfile(settings, descriptor.id)),
    ).length;

    const section = containerEl.createDiv({ cls: "attest-settings-profile-section" });
    const header = section.createDiv({ cls: "attest-settings-profile-section__header" });
    header.createEl("h3", { text: t("settings.webSources.heading") });
    header.createSpan({
      cls: "attest-settings-websource-section__count",
      text: t("settings.webSources.count", {
        enabled: enabledTotal,
        total: WEB_SOURCE_CATALOG.length,
      }),
    });
    section.createEl("p", {
      cls: "attest-settings-websource-section__desc",
      text: t("settings.webSources.desc"),
    });

    const table = section.createDiv({
      cls: "attest-settings-profile-table attest-settings-websource-table",
    });
    const tableHeader = table.createDiv({
      cls: "attest-settings-profile-table__header attest-settings-websource-table__header",
      attr: { role: "row" },
    });
    tableHeader.createSpan({ text: t("settings.webSources.column.source") });
    tableHeader.createSpan({ text: t("settings.webSources.column.actions") });
    tableHeader.createSpan({ text: t("settings.webSources.column.state") });
    const listEl = table.createDiv({ cls: "attest-settings-profile-list" });

    for (const category of categoriesInCatalogOrder()) {
      const descriptors = WEB_SOURCE_CATALOG.filter(
        (descriptor) => descriptor.category === category,
      );
      const enabledCount = descriptors.filter((descriptor) =>
        isWebSourceActive(getWebSourceProfile(settings, descriptor.id)),
      ).length;
      listEl.createDiv({
        cls: "attest-settings-websource-list__category",
        text: t("settings.webSources.categoryCount", {
          category: t(CATEGORY_MESSAGE_KEYS[category]),
          enabled: enabledCount,
          total: descriptors.length,
        }),
      });
      for (const descriptor of descriptors) {
        this.renderSourceRow(listEl, descriptor);
      }
    }
  }

  private renderSourceRow(containerEl: HTMLElement, descriptor: WebSourceDescriptor): void {
    const settings = this.ctx.getSettings();
    const profile = getWebSourceProfile(settings, descriptor.id);
    const configured = areCredentialsComplete(descriptor, profile.credentials);

    const row = containerEl.createDiv({
      cls: "attest-settings-profile-list__item attest-settings-websource-list__item",
    });
    const nameEl = row.createDiv({ cls: "attest-settings-profile-list__name" });
    nameEl.createDiv({ text: descriptor.label });
    nameEl.createDiv({
      cls: "attest-settings-index-list__meta",
      text: rowMeta(this.ctx.t, descriptor, configured),
    });

    this.renderActionsCell(row, descriptor, configured);
    this.renderLampCell(row, descriptor, profile.activation, configured);
  }

  private renderActionsCell(
    row: HTMLElement,
    descriptor: WebSourceDescriptor,
    configured: boolean,
  ): void {
    const { t } = this.ctx;
    const actions = row.createDiv({ cls: "attest-settings-websource-list__actions" });

    if (!configured) {
      const setup = actions.createEl("button", {
        cls: "attest-settings-websource-setup",
        text: t("settings.webSources.setUp"),
        attr: {
          type: "button",
          "aria-label": t("settings.webSources.setUpAria", { source: descriptor.label }),
        },
      });
      setup.addEventListener("click", () => this.openConfigModal(descriptor));
      return;
    }

    createIconButton(actions, {
      icon: "pencil",
      label: t("settings.webSources.configure", { source: descriptor.label }),
      onClick: () => this.openConfigModal(descriptor),
    });
  }

  private renderLampCell(
    row: HTMLElement,
    descriptor: WebSourceDescriptor,
    activation: WebSourceActivation,
    configured: boolean,
  ): void {
    const { t } = this.ctx;
    const cell = row.createDiv({ cls: "attest-settings-websource-list__state" });
    if (!configured) {
      cell.createSpan({ cls: "attest-settings-websource-lamp is-unavailable" });
      return;
    }

    const issue = activation === "off" ? undefined : this.ctx.getSourceIssue(descriptor.id);
    const state = activation === "off" ? "off" : issue ? "warning" : "on";
    const next = nextActivation(activation);
    const title = issue
      ? t("settings.webSources.lampIssueTitle", {
          issue: t(ISSUE_MESSAGE_KEYS[issue.reason]),
          next: t(ACTIVATION_MESSAGE_KEYS[next]),
        })
      : t("settings.webSources.lampTitle", {
          source: descriptor.label,
          current: t(ACTIVATION_MESSAGE_KEYS[activation]),
          next: t(ACTIVATION_MESSAGE_KEYS[next]),
        });

    const lamp = cell.createEl("button", {
      cls: `attest-settings-websource-lamp is-${state}${activation === "always" ? " is-always" : ""}`,
      attr: { type: "button", "aria-label": title, title },
    });
    lamp.addEventListener("click", async () => {
      const settings = this.ctx.getSettings();
      const profile = getWebSourceProfile(settings, descriptor.id);
      upsertWebSourceProfile(settings, {
        ...profile,
        activation: nextActivation(profile.activation),
      });
      await this.ctx.saveSettings();
      this.ctx.requestRedisplay();
    });
  }

  private openConfigModal(descriptor: WebSourceDescriptor): void {
    new WebSourceModal(this.ctx.app, {
      t: this.ctx.t,
      getDirection: this.ctx.getDirection,
      descriptor,
      profile: getWebSourceProfile(this.ctx.getSettings(), descriptor.id),
      onSave: async (updated) => {
        upsertWebSourceProfile(this.ctx.getSettings(), updated);
        this.ctx.resetSourceIssue(descriptor.id);
        await this.ctx.saveSettings();
        this.ctx.requestRedisplay();
      },
    }).open();
  }
}

/** Lamp clicks cycle the three activations: off → auto → always → off. */
function nextActivation(activation: WebSourceActivation): WebSourceActivation {
  if (activation === "off") return "auto";
  return activation === "auto" ? "always" : "off";
}

function categoriesInCatalogOrder(): WebSourceCategory[] {
  const seen: WebSourceCategory[] = [];
  for (const descriptor of WEB_SOURCE_CATALOG) {
    if (!seen.includes(descriptor.category)) {
      seen.push(descriptor.category);
    }
  }
  return seen;
}

function rowMeta(t: Translate, descriptor: WebSourceDescriptor, configured: boolean): string {
  const parts = [descriptor.freeTierNote];
  const required = descriptor.credentials.filter((field) => field.optional !== true);
  if (!configured && required.length > 0) {
    parts.push(
      t("settings.webSources.meta.required", {
        fields: required.map((field) => field.label).join(", "),
      }),
    );
  } else if (descriptor.credentials.length > 0 && configured) {
    parts.push(t("settings.webSources.meta.configured"));
  }
  return parts.join(" · ");
}
