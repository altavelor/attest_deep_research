import { Setting, setIcon } from "obsidian";

import { EnrichmentProfileState, IndexingState } from "@adapters/indexing";
import type { Translate } from "@adapters/i18n";

export interface ProfileStatus {
  kind: "is-default" | "is-suspended";
  label: string;
  title: string;
}

export function renderCategoryHeading(
  containerEl: HTMLElement,
  name: string,
  description?: string,
): void {
  const setting = new Setting(containerEl).setName(name).setHeading();

  if (description) {
    setting.setDesc(description);
  }

  setting.settingEl.addClass("attest-settings__category-heading");
}

export function renderSubcategoryHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl)
    .setName(name)
    .setHeading()
    .settingEl.addClass("attest-settings__subcategory-heading");
}

export function statusForProfile(
  t: Translate,
  profile: {
    isSuspended?: boolean;
    suspendedReason?: string;
  },
): ProfileStatus | null {
  if (profile.isSuspended) {
    return {
      kind: "is-suspended",
      label: t("settings.status.suspended"),
      title: profile.suspendedReason ?? t("settings.status.suspended"),
    };
  }

  return null;
}

export function formatIndexRowProgress(t: Translate, state: IndexingState): string {
  if (state.chunksTotal !== undefined && state.chunksTotal > 0) {
    return t("settings.indexStatus.progress.chunks", {
      embedded: state.chunksEmbedded ?? 0,
      total: state.chunksTotal,
      file: "",
    });
  }

  return t("settings.indexStatus.progress.files", {
    percent: Math.round(state.progress * 100),
    scanned: state.scannedFiles,
    total: state.totalFiles,
    file: "",
  });
}

export function formatEnrichmentStatus(t: Translate, state: EnrichmentProfileState): string {
  switch (state.status) {
    case "running":
      return t("settings.enrichment.running", {
        scope:
          state.total > 0
            ? t("settings.enrichment.scope", { processed: state.processed, total: state.total })
            : "",
        file: state.currentSourcePath
          ? t("settings.enrichment.file", { file: baseName(state.currentSourcePath) })
          : "",
        phase: enrichmentPhaseLabel(t, state),
      });
    case "done":
      return t("settings.enrichment.done", {
        extracted: state.extracted,
        skipped: state.skipped,
        failed:
          state.failed > 0 ? t("settings.enrichment.doneFailed", { failed: state.failed }) : "",
        total: state.total,
      });
    case "error":
      return t("settings.enrichment.error", {
        message: state.errorMessage ?? t("settings.enrichment.unknownError"),
      });
    default:
      return "";
  }
}

function enrichmentPhaseLabel(t: Translate, state: EnrichmentProfileState): string {
  switch (state.phase) {
    case "metadata":
      return t("settings.enrichment.phase.metadata");
    case "sections":
      return state.sectionCount
        ? t("settings.enrichment.phase.sectionsWithCount", {
            index: state.sectionIndex ?? 0,
            count: state.sectionCount,
          })
        : t("settings.enrichment.phase.sections");
    case "document":
      return t("settings.enrichment.phase.document");
    case "claims":
      return state.sectionCount
        ? t("settings.enrichment.phase.claimsWithCount", {
            index: state.sectionIndex ?? 0,
            count: state.sectionCount,
          })
        : t("settings.enrichment.phase.claims");
    default:
      return state.total === 0 ? t("settings.enrichment.phase.listingSources") : "";
  }
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function renderModalActions(
  containerEl: HTMLElement,
  actions: { t: Translate; onCancel: () => void; onSave: () => void; saveLabel?: string },
): void {
  new Setting(containerEl)
    .setClass("attest-profile-modal__actions")
    .addButton((button) =>
      button.setButtonText(actions.t("common.cancel")).onClick(() => actions.onCancel()),
    )
    .addButton((button) =>
      button
        .setCta()
        .setButtonText(actions.saveLabel ?? actions.t("common.save"))
        .onClick(() => actions.onSave()),
    );
}

export function createIconButton(
  containerEl: HTMLElement,
  options: {
    icon: string;
    className?: string;
    label: string;
    disabled?: boolean;
    onClick: () => void;
  },
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: ["clickable-icon", "attest-settings__icon-button", options.className]
      .filter(Boolean)
      .join(" "),
    attr: {
      type: "button",
      "aria-label": options.label,
      "aria-disabled": String(options.disabled === true),
      title: options.label,
    },
  });
  button.disabled = options.disabled === true;
  setIcon(button, options.icon);
  if (!button.disabled) {
    button.addEventListener("click", () => options.onClick());
  }
  return button;
}

export function optionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}
