import { App, Modal, Setting, ToggleComponent, setIcon } from "obsidian";

import { IndexProfile } from "@adapters/indexing";
import { ChatModelProfile, EmbeddingModelProfile } from "@adapters/settings";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";

export interface IndexRunPlan {
  mode: "start" | "update" | "rebuild";
  embedding?: { embeddingModelProfileId: string };
  metadata?: { chatModelProfileId: string; force?: boolean };
}

export interface IndexRunModalOptions {
  t: Translate;
  getDirection?(): TextDirection;
  profile: IndexProfile;

  hasMetadata: boolean;
  embeddingModels: EmbeddingModelProfile[];
  chatModels: ChatModelProfile[];
  defaultChatModelProfileId: string;
  isMobile?: boolean;
  onSubmit(plan: IndexRunPlan): void;
}

/**
 * Pre-run configuration for the unified index action (start / update / rebuild
 * + metadata enrichment). Closable via Esc and the corner ✕ — both are native
 * Obsidian Modal behavior.
 */
export class IndexRunModal extends Modal {
  private embeddingEnabled = true;
  private metadataEnabled: boolean;
  private metadataForce = false;
  private embeddingModelProfileId: string;
  private chatModelProfileId: string;
  private warningEl: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private metadataToggle: ToggleComponent | null = null;
  private metadataSectionEl: HTMLElement | null = null;
  private mobileRebuildArmed = false;

  constructor(
    app: App,
    private readonly options: IndexRunModalOptions,
  ) {
    super(app);
    this.metadataEnabled = this.indexExists() && options.hasMetadata;
    this.embeddingModelProfileId = options.embeddingModels.some(
      (profile) => profile.id === options.profile.embeddingModelProfileId,
    )
      ? options.profile.embeddingModelProfileId
      : (options.embeddingModels[0]?.id ?? "");
    this.chatModelProfileId = options.chatModels.some(
      (profile) => profile.id === options.defaultChatModelProfileId,
    )
      ? options.defaultChatModelProfileId
      : (options.chatModels[0]?.id ?? "");
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    const { contentEl } = this;
    const { t } = this.options;
    contentEl.empty();
    this.modalEl.addClass("attest-profile-modal-host");
    contentEl.addClass("attest-profile-modal");
    contentEl.createEl("h2", {
      text: this.indexExists()
        ? t("settings.indexRun.updateTitle", { profile: this.options.profile.name })
        : t("settings.indexRun.indexTitle", { profile: this.options.profile.name }),
    });

    this.renderEmbeddingSection(contentEl);
    this.renderAdvancedSection(contentEl);
    this.warningEl = contentEl.createDiv({ cls: "attest-index-run__warning" });
    this.footerEl = contentEl.createDiv();
    this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private indexExists(): boolean {
    return Boolean(this.options.profile.lastIndexedAt);
  }

  private embeddingModelChanged(): boolean {
    return (
      this.indexExists() &&
      this.embeddingEnabled &&
      this.embeddingModelProfileId !== this.options.profile.embeddingModelProfileId
    );
  }

  private renderEmbeddingSection(containerEl: HTMLElement): void {
    const { t } = this.options;
    const section = containerEl.createDiv({ cls: "attest-index-run__section" });
    new Setting(section)
      .setName(t("settings.indexRun.embedding.name"))
      .setDesc(t("settings.indexRun.embedding.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.embeddingEnabled).onChange((value) => {
          this.embeddingEnabled = value;
          if (!value && !this.indexExists()) {
            this.metadataEnabled = false;
          }
          this.refresh();
        }),
      );
    new Setting(section)
      .setName(t("settings.indexRun.embeddingModel.name"))
      .addDropdown((dropdown) => {
        for (const profile of this.options.embeddingModels) {
          dropdown.addOption(
            profile.id,
            t("settings.indexRun.modelOption", {
              name: profile.name,
              model: profile.modelName,
            }),
          );
        }
        dropdown.setValue(this.embeddingModelProfileId).onChange((value) => {
          this.embeddingModelProfileId = value;
          this.refresh();
        });
      });
  }

  private renderAdvancedSection(containerEl: HTMLElement): void {
    const { t } = this.options;
    const details = containerEl.createEl("details", { cls: "attest-index-run__advanced" });
    details.open = this.metadataEnabled;
    details.createEl("summary", {
      cls: "attest-index-run__advanced-summary",
      text: t("common.advanced"),
    });
    const content = details.createDiv({ cls: "attest-index-run__advanced-content" });

    const warning = content.createDiv({ cls: "attest-index-run__token-warning" });
    setIcon(warning.createSpan({ cls: "attest-index-run__token-warning-icon" }), "alert-triangle");
    warning.createSpan({ text: t("settings.indexRun.tokenWarning") });

    this.renderMetadataSection(content);
  }

  private renderMetadataSection(containerEl: HTMLElement): void {
    const { t } = this.options;
    const section = containerEl.createDiv({ cls: "attest-index-run__section" });
    this.metadataSectionEl = section;
    new Setting(section)
      .setName(t("settings.indexRun.metadata.name"))
      .setDesc(t("settings.indexRun.metadata.desc"))
      .addToggle((toggle) => {
        toggle.setValue(this.metadataEnabled).onChange((value) => {
          this.metadataEnabled = value;
          this.refresh();
        });
        this.metadataToggle = toggle;
      });
    new Setting(section)
      .setName(t("settings.indexRun.metadataModel.name"))
      .addDropdown((dropdown) => {
        for (const profile of this.options.chatModels) {
          dropdown.addOption(
            profile.id,
            t("settings.indexRun.modelOption", {
              name: profile.name,
              model: profile.modelName,
            }),
          );
        }
        dropdown.setValue(this.chatModelProfileId).onChange((value) => {
          this.chatModelProfileId = value;
        });
      });
    if (this.options.hasMetadata) {
      new Setting(section)
        .setName(t("settings.indexRun.reextract.name"))
        .setDesc(t("settings.indexRun.reextract.desc"))
        .addToggle((toggle) =>
          toggle.setValue(this.metadataForce).onChange((value) => {
            this.metadataForce = value;
          }),
        );
    }
  }

  /** Re-derives dependent UI state: warnings, footer buttons, section gating. */
  private refresh(): void {
    const metadataAllowed = this.indexExists() || this.embeddingEnabled;
    if (!metadataAllowed && this.metadataEnabled) {
      this.metadataEnabled = false;
      this.metadataToggle?.setValue(false);
    }
    this.metadataToggle?.setDisabled(!metadataAllowed);
    this.metadataSectionEl?.toggleClass("is-disabled", !metadataAllowed);

    if (this.warningEl) {
      this.warningEl.empty();
      if (this.mobileRebuildArmed) {
        this.warningEl.setText(this.options.t("settings.indexRun.mobileRebuildWarning"));
      } else if (this.embeddingModelChanged()) {
        this.warningEl.setText(this.options.t("settings.indexRun.embeddingChangedWarning"));
      }
    }

    this.renderFooter();
  }

  private renderFooter(): void {
    if (!this.footerEl) {
      return;
    }
    const { t } = this.options;
    this.footerEl.empty();
    const actions = new Setting(this.footerEl)
      .setClass("attest-profile-modal__actions")
      .setClass("attest-index-run__actions");

    if (!this.indexExists()) {
      actions.addButton((button) => {
        button
          .setCta()
          .setButtonText(t("settings.indexRun.start"))
          .setDisabled(!this.embeddingEnabled)
          .onClick(() => this.submit("start"));
      });
      return;
    }

    actions.addButton((button) => {
      button
        .setButtonText(t("settings.indexRun.rebuild"))
        .setDisabled(!this.embeddingEnabled)
        .onClick(() => this.submit("rebuild"));
    });
    actions.addButton((button) => {
      button
        .setCta()
        .setButtonText(t("settings.indexRun.update"))
        .setDisabled(!this.embeddingEnabled && !this.metadataEnabled)
        .onClick(() => this.submit("update"));
    });
  }

  private submit(mode: IndexRunPlan["mode"]): void {
    const effectiveMode = mode !== "start" && this.embeddingModelChanged() ? "rebuild" : mode;
    if (
      effectiveMode === "rebuild" &&
      this.options.isMobile === true &&
      this.indexExists() &&
      !this.mobileRebuildArmed
    ) {
      this.mobileRebuildArmed = true;
      this.refresh();
      return;
    }
    this.options.onSubmit({
      mode: effectiveMode,
      ...(this.embeddingEnabled
        ? { embedding: { embeddingModelProfileId: this.embeddingModelProfileId } }
        : {}),
      ...(this.metadataEnabled
        ? {
            metadata: {
              chatModelProfileId: this.chatModelProfileId,
              ...(this.metadataForce ? { force: true } : {}),
            },
          }
        : {}),
    });
    this.close();
  }
}
