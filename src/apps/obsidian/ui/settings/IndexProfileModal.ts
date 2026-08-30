import { App, Modal, Notice, Setting } from "obsidian";

import { IndexProfile } from "@adapters/indexing";
import { parseNonNegativeInteger, parsePositiveInteger } from "@shared";
import { MAX_PROFILE_NAME_LENGTH } from "@adapters/settings";
import {
  DEFAULT_INDEX_PROFILE,
  createIndexProfile,
  withVaultConfigExclusion,
} from "@adapters/settings";
import {
  createProfileId,
  hasDuplicateProfileName,
  isValidIndexProfileName,
} from "@adapters/settings";
import { EmbeddingModelProfile } from "@adapters/settings";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { IndexPathPickerModal } from "./IndexPathPickerModal";
import { renderModalActions } from "./shared";

export interface IndexProfileModalOptions {
  t: Translate;
  getDirection?: () => TextDirection;
  profile?: IndexProfile;
  profiles: IndexProfile[];
  embeddingModels: EmbeddingModelProfile[];
  defaultEmbeddingModelProfileId?: string;
  onSave: (profile: IndexProfile) => Promise<void>;
}

export class IndexProfileModal extends Modal {
  private name = this.options.profile?.name ?? "";
  private mode: IndexProfile["mode"] = this.options.profile?.mode ?? "wholeVault";
  private includeFolders = [...(this.options.profile?.includeFolders ?? [])];
  private excludeGlobs: string[];
  private embeddingModelProfileId =
    this.options.profile?.embeddingModelProfileId ??
    this.resolveDefaultEmbeddingModelProfileId() ??
    "";
  private chunkSize = String(this.options.profile?.chunkSize ?? DEFAULT_INDEX_PROFILE.chunkSize);
  private chunkOverlap = String(
    this.options.profile?.chunkOverlap ?? DEFAULT_INDEX_PROFILE.chunkOverlap,
  );
  private embeddingBatchSize = String(
    this.options.profile?.embeddingBatchSize ?? DEFAULT_INDEX_PROFILE.embeddingBatchSize,
  );
  private pdfChunkSize = String(
    this.options.profile?.pdfChunkSize ?? DEFAULT_INDEX_PROFILE.pdfChunkSize,
  );
  private pdfChunkOverlap = String(
    this.options.profile?.pdfChunkOverlap ?? DEFAULT_INDEX_PROFILE.pdfChunkOverlap,
  );

  constructor(
    app: App,
    private readonly options: IndexProfileModalOptions,
  ) {
    super(app);
    this.excludeGlobs = withVaultConfigExclusion(
      this.options.profile?.excludeGlobs ?? DEFAULT_INDEX_PROFILE.excludeGlobs,
      app.vault.configDir,
    );
  }

  private resolveDefaultEmbeddingModelProfileId(): string | undefined {
    const defaultId = this.options.defaultEmbeddingModelProfileId;
    if (
      defaultId &&
      this.options.embeddingModels.some(
        (profile) => profile.id === defaultId && profile.isSuspended !== true,
      )
    ) {
      return defaultId;
    }

    return this.options.embeddingModels.find((profile) => profile.isSuspended !== true)?.id;
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    const { contentEl } = this;
    const { t } = this.options;
    contentEl.empty();
    this.modalEl.addClass("attest-profile-modal-host");
    contentEl.addClass("attest-profile-modal");
    contentEl.createEl("h2", {
      text: this.options.profile
        ? t("settings.indexProfileModal.editTitle")
        : t("settings.indexProfileModal.addTitle"),
    });

    new Setting(contentEl)
      .setName(t("settings.indexProfileModal.name.name"))
      .setDesc(t("settings.indexProfileModal.name.desc", { max: MAX_PROFILE_NAME_LENGTH }))
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

    new Setting(contentEl)
      .setName(t("settings.indexProfileModal.mode.name"))
      .setDesc(t("settings.indexProfileModal.mode.desc"))
      .addDropdown((dropdown) =>
        dropdown
          .addOption("wholeVault", t("settings.indexProfileModal.mode.wholeVault"))
          .addOption("selected", t("settings.indexProfileModal.mode.selected"))
          .setValue(this.mode)
          .onChange((value) => {
            this.mode = value === "selected" ? "selected" : "wholeVault";
            if (this.mode === "wholeVault") {
              this.includeFolders = ["/"];
            } else {
              this.excludeGlobs = [];
            }
            this.onOpen();
          }),
      );

    if (this.mode === "selected") {
      this.renderPathSetting(
        contentEl,
        t("settings.indexProfileModal.included.name"),
        t("settings.indexProfileModal.included.desc"),
        this.includeFolders,
        (paths) => {
          this.includeFolders = paths;
          this.onOpen();
        },
      );
    } else {
      this.renderPathSetting(
        contentEl,
        t("settings.indexProfileModal.excluded.name"),
        t("settings.indexProfileModal.excluded.desc"),
        this.excludeGlobs,
        (paths) => {
          this.excludeGlobs = paths;
          this.onOpen();
        },
      );
    }

    new Setting(contentEl)
      .setName(t("settings.indexProfileModal.embeddingModel.name"))
      .setDesc(t("settings.indexProfileModal.embeddingModel.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("", t("settings.indexProfileModal.embeddingModel.placeholder"));
        for (const profile of this.options.embeddingModels.filter(
          (candidate) => candidate.isSuspended !== true,
        )) {
          dropdown.addOption(profile.id, profile.name);
        }
        dropdown.setValue(this.embeddingModelProfileId).onChange((value) => {
          this.embeddingModelProfileId = value;
        });
      });

    this.renderNumberSetting(
      contentEl,
      t("settings.indexProfileModal.chunkSize.name"),
      t("settings.indexProfileModal.chunkSize.desc"),
      this.chunkSize,
      (value) => {
        this.chunkSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      t("settings.indexProfileModal.chunkOverlap.name"),
      t("settings.indexProfileModal.chunkOverlap.desc"),
      this.chunkOverlap,
      (value) => {
        this.chunkOverlap = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      t("settings.indexProfileModal.embeddingBatchSize.name"),
      t("settings.indexProfileModal.embeddingBatchSize.desc"),
      this.embeddingBatchSize,
      (value) => {
        this.embeddingBatchSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      t("settings.indexProfileModal.pdfChunkSize.name"),
      t("settings.indexProfileModal.pdfChunkSize.desc"),
      this.pdfChunkSize,
      (value) => {
        this.pdfChunkSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      t("settings.indexProfileModal.pdfChunkOverlap.name"),
      t("settings.indexProfileModal.pdfChunkOverlap.desc"),
      this.pdfChunkOverlap,
      (value) => {
        this.pdfChunkOverlap = value;
      },
    );

    renderModalActions(contentEl, {
      t,
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderPathSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    paths: string[],
    onChange: (paths: string[]) => void,
  ): void {
    const { t } = this.options;
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addButton((button) =>
        button.setButtonText(t("settings.indexProfileModal.choose")).onClick(() => {
          new IndexPathPickerModal(this.app, {
            t,
            getDirection: this.options.getDirection,
            selectedPaths: paths,
            onSubmit: onChange,
          }).open();
        }),
      );
    const selectedEl = containerEl.createDiv({ cls: "attest-index-path-summary" });
    if (paths.length === 0) {
      selectedEl.createDiv({
        cls: "attest-index-path-summary__empty",
        text: t("settings.indexProfileModal.noPaths"),
      });
      return;
    }

    for (const path of paths) {
      selectedEl.createDiv({
        cls: "attest-index-path-summary__item",
        text: path,
        attr: { title: path },
      });
    }
  }

  private renderNumberSetting(
    containerEl: HTMLElement,
    name: string,
    description: string,
    value: string,
    onChange: (value: string) => void,
  ): void {
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => text.setValue(value).onChange((nextValue) => onChange(nextValue.trim())));
  }

  private async save(): Promise<void> {
    const { t } = this.options;
    const chunkSize = parsePositiveInteger(this.chunkSize);
    const chunkOverlap = parseNonNegativeInteger(this.chunkOverlap);
    const embeddingBatchSize = parsePositiveInteger(this.embeddingBatchSize);
    const pdfChunkSize = parsePositiveInteger(this.pdfChunkSize);
    const pdfChunkOverlap = parseNonNegativeInteger(this.pdfChunkOverlap);

    if (!isValidIndexProfileName(this.name)) {
      new Notice(t("settings.indexProfileModal.error.name"));
      return;
    }

    if (hasDuplicateProfileName(this.options.profiles, this.name, this.options.profile?.id)) {
      new Notice(t("settings.profileModal.error.nameUnique"));
      return;
    }

    if (!this.embeddingModelProfileId) {
      new Notice(t("settings.indexProfileModal.error.embeddingModel"));
      return;
    }

    if (this.mode === "selected" && this.includeFolders.length === 0) {
      new Notice(t("settings.indexProfileModal.error.includedPath"));
      return;
    }

    if (
      chunkSize === null ||
      chunkOverlap === null ||
      embeddingBatchSize === null ||
      pdfChunkSize === null ||
      pdfChunkOverlap === null
    ) {
      new Notice(t("settings.indexProfileModal.error.numbers"));
      return;
    }

    const now = new Date().toISOString();
    const id = this.options.profile?.id ?? createProfileId("index");
    const profile = createIndexProfile({
      ...this.options.profile,
      id,
      name: this.name,
      mode: this.mode,
      indexFolder: this.options.profile?.indexFolder ?? `.attest/indexes/${id}`,
      includeFolders: this.mode === "wholeVault" ? ["/"] : this.includeFolders,
      excludeGlobs: this.mode === "wholeVault" ? this.excludeGlobs : [],
      embeddingModelProfileId: this.embeddingModelProfileId,
      chunkSize,
      chunkOverlap,
      embeddingBatchSize,
      pdfChunkSize,
      pdfChunkOverlap,
      createdAt: this.options.profile?.createdAt ?? now,
      updatedAt: now,
    });

    if (
      this.options.profile?.lastIndexedAt &&
      hasIndexingConfigChanged(this.options.profile, profile)
    ) {
      new Notice(t("settings.indexProfileModal.notice.rebuild"));
    }

    await this.options.onSave(profile);
    this.close();
  }
}

function hasIndexingConfigChanged(left: IndexProfile, right: IndexProfile): boolean {
  return (
    left.mode !== right.mode ||
    left.embeddingModelProfileId !== right.embeddingModelProfileId ||
    left.chunkSize !== right.chunkSize ||
    left.chunkOverlap !== right.chunkOverlap ||
    left.embeddingBatchSize !== right.embeddingBatchSize ||
    left.pdfChunkSize !== right.pdfChunkSize ||
    left.pdfChunkOverlap !== right.pdfChunkOverlap ||
    left.includeFolders.join("\n") !== right.includeFolders.join("\n") ||
    left.excludeGlobs.join("\n") !== right.excludeGlobs.join("\n")
  );
}
