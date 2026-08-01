import { App } from "obsidian";

import {
  areCredentialsComplete,
  WEB_SOURCE_CATALOG,
  WebSourceCategory,
  WebSourceDescriptor,
} from "@core/web";
import { IxplorerSettings, WEB_SOURCES_DESCRIPTION } from "@adapters/settings";
import { getWebSourceProfile, upsertWebSourceProfile } from "@adapters/settings";
import type { WebSourceIssue } from "@application/web";
import { createIconButton } from "./shared";
import { WebSourceModal } from "./WebSourceModal";

export interface WebSourcesSectionContext {
  app: App;
  getSettings(): IxplorerSettings;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;
  /** Runtime health of a source (auto-suspend state); drives the yellow lamp. */
  getSourceIssue(sourceId: string): WebSourceIssue | undefined;
  /** Clears a recorded issue after the user reconfigures the source. */
  resetSourceIssue(sourceId: string): void;
}

const CATEGORY_LABELS: Record<WebSourceCategory, string> = {
  serp: "General web search",
  neural: "AI search",
  academic: "Academic",
  encyclopedia: "Encyclopedia",
  community: "Developer & community",
  news: "News",
  fetch: "Page fetch fallback",
};

const ISSUE_LABELS: Record<WebSourceIssue["reason"], string> = {
  unauthorized: "Credentials rejected — check the API key",
  "rate-limited": "Rate limit exceeded — retries automatically later",
};

/**
 * "External sources" hub list. Rows are fixed by the catalog: sources are
 * configured and toggled, never added or deleted. Unconfigured sources show a
 * "Set up…" action; configured ones show a status lamp that toggles the source
 * (green — enabled, yellow — enabled with a runtime problem, grey — off).
 */
export class WebSourcesSection {
  constructor(private readonly ctx: WebSourcesSectionContext) {}

  render(containerEl: HTMLElement): void {
    const settings = this.ctx.getSettings();
    const enabledTotal = WEB_SOURCE_CATALOG.filter(
      (descriptor) => getWebSourceProfile(settings, descriptor.id).enabled,
    ).length;

    const section = containerEl.createDiv({ cls: "ixplorer-settings-profile-section" });
    const header = section.createDiv({ cls: "ixplorer-settings-profile-section__header" });
    header.createEl("h3", { text: "External sources" });
    header.createSpan({
      cls: "ixplorer-settings-websource-section__count",
      text: `${enabledTotal} of ${WEB_SOURCE_CATALOG.length} enabled`,
    });
    section.createEl("p", {
      cls: "ixplorer-settings-websource-section__desc",
      text: WEB_SOURCES_DESCRIPTION,
    });

    const table = section.createDiv({
      cls: "ixplorer-settings-profile-table ixplorer-settings-websource-table",
    });
    const tableHeader = table.createDiv({
      cls: "ixplorer-settings-profile-table__header ixplorer-settings-websource-table__header",
      attr: { role: "row" },
    });
    tableHeader.createSpan({ text: "Source" });
    tableHeader.createSpan({ text: "Actions" });
    tableHeader.createSpan({ text: "State" });
    const listEl = table.createDiv({ cls: "ixplorer-settings-profile-list" });

    for (const category of categoriesInCatalogOrder()) {
      const descriptors = WEB_SOURCE_CATALOG.filter(
        (descriptor) => descriptor.category === category,
      );
      const enabledCount = descriptors.filter(
        (descriptor) => getWebSourceProfile(settings, descriptor.id).enabled,
      ).length;
      listEl.createDiv({
        cls: "ixplorer-settings-websource-list__category",
        text: `${CATEGORY_LABELS[category]} · ${enabledCount}/${descriptors.length}`,
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
      cls: "ixplorer-settings-profile-list__item ixplorer-settings-websource-list__item",
    });
    const nameEl = row.createDiv({ cls: "ixplorer-settings-profile-list__name" });
    nameEl.createDiv({ text: descriptor.label });
    nameEl.createDiv({
      cls: "ixplorer-settings-index-list__meta",
      text: rowMeta(descriptor, configured),
    });

    this.renderActionsCell(row, descriptor, configured);
    this.renderLampCell(row, descriptor, profile.enabled, configured);
  }

  private renderActionsCell(
    row: HTMLElement,
    descriptor: WebSourceDescriptor,
    configured: boolean,
  ): void {
    const actions = row.createDiv({ cls: "ixplorer-settings-websource-list__actions" });

    if (!configured) {
      const setup = actions.createEl("button", {
        cls: "ixplorer-settings-websource-setup",
        text: "Set up…",
        attr: { type: "button", "aria-label": `Set up ${descriptor.label}` },
      });
      setup.addEventListener("click", () => this.openConfigModal(descriptor));
      return;
    }

    createIconButton(actions, {
      icon: "pencil",
      label: `Configure ${descriptor.label}`,
      onClick: () => this.openConfigModal(descriptor),
    });
  }

  private renderLampCell(
    row: HTMLElement,
    descriptor: WebSourceDescriptor,
    enabled: boolean,
    configured: boolean,
  ): void {
    const cell = row.createDiv({ cls: "ixplorer-settings-websource-list__state" });
    if (!configured) {
      cell.createSpan({ cls: "ixplorer-settings-websource-lamp is-unavailable" });
      return;
    }

    const issue = enabled ? this.ctx.getSourceIssue(descriptor.id) : undefined;
    const state = !enabled ? "off" : issue ? "warning" : "on";
    const title = !enabled
      ? `Off — click to enable ${descriptor.label}`
      : issue
        ? `${ISSUE_LABELS[issue.reason]} — click to disable`
        : `Enabled — click to disable ${descriptor.label}`;

    const lamp = cell.createEl("button", {
      cls: `ixplorer-settings-websource-lamp is-${state}`,
      attr: { type: "button", "aria-label": title, title },
    });
    lamp.addEventListener("click", async () => {
      const settings = this.ctx.getSettings();
      const profile = getWebSourceProfile(settings, descriptor.id);
      upsertWebSourceProfile(settings, { ...profile, enabled: !profile.enabled });
      await this.ctx.saveSettings();
      this.ctx.requestRedisplay();
    });
  }

  private openConfigModal(descriptor: WebSourceDescriptor): void {
    new WebSourceModal(this.ctx.app, {
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

function categoriesInCatalogOrder(): WebSourceCategory[] {
  const seen: WebSourceCategory[] = [];
  for (const descriptor of WEB_SOURCE_CATALOG) {
    if (!seen.includes(descriptor.category)) {
      seen.push(descriptor.category);
    }
  }
  return seen;
}

function rowMeta(descriptor: WebSourceDescriptor, configured: boolean): string {
  const parts = [descriptor.freeTierNote];
  const required = descriptor.credentials.filter((field) => field.optional !== true);
  if (!configured && required.length > 0) {
    parts.push(`${required.map((field) => field.label).join(", ")} required`);
  } else if (descriptor.credentials.length > 0 && configured) {
    parts.push("configured");
  }
  return parts.join(" · ");
}
