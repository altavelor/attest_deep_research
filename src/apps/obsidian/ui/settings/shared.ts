import { Setting, setIcon } from "obsidian";

import { EnrichmentProfileState, IndexingState } from "@adapters/indexing";

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

  setting.settingEl.addClass("ixplorer-settings__category-heading");
}

export function renderSubcategoryHeading(containerEl: HTMLElement, name: string): void {
  new Setting(containerEl)
    .setName(name)
    .setHeading()
    .settingEl.addClass("ixplorer-settings__subcategory-heading");
}

export function statusForProfile(profile: {
  isSuspended?: boolean;
  suspendedReason?: string;
}): ProfileStatus | null {
  if (profile.isSuspended) {
    return {
      kind: "is-suspended",
      label: "Suspended",
      title: profile.suspendedReason ?? "Suspended",
    };
  }

  return null;
}

export function formatIndexRowProgress(state: IndexingState): string {
  if (state.chunksTotal !== undefined && state.chunksTotal > 0) {
    return ` · ${state.chunksEmbedded ?? 0}/${state.chunksTotal} chunks`;
  }

  return ` · ${Math.round(state.progress * 100)}% · ${state.scannedFiles}/${state.totalFiles} files`;
}

export function formatEnrichmentStatus(state: EnrichmentProfileState): string {
  switch (state.status) {
    case "running":
      return `Enriching metadata · ${state.processed}/${state.total}`;
    case "done":
      return (
        `Metadata: ${state.extracted} extracted, ${state.skipped} up to date` +
        (state.failed > 0 ? `, ${state.failed} failed` : "") +
        ` (${state.total} sources)`
      );
    case "error":
      return `Metadata enrichment failed: ${state.errorMessage ?? "unknown error"}`;
    default:
      return "";
  }
}

export function renderModalActions(
  containerEl: HTMLElement,
  actions: { onCancel(): void; onSave(): void; saveLabel?: string },
): void {
  new Setting(containerEl)
    .setClass("ixplorer-profile-modal__actions")
    .addButton((button) => button.setButtonText("Cancel").onClick(actions.onCancel))
    .addButton((button) =>
      button
        .setCta()
        .setButtonText(actions.saveLabel ?? "Save")
        .onClick(actions.onSave),
    );
}

export function createIconButton(
  containerEl: HTMLElement,
  options: {
    icon: string;
    className?: string;
    label: string;
    disabled?: boolean;
    onClick(): void;
  },
): HTMLButtonElement {
  const button = containerEl.createEl("button", {
    cls: ["clickable-icon", "ixplorer-settings__icon-button", options.className]
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
    button.addEventListener("click", options.onClick);
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
