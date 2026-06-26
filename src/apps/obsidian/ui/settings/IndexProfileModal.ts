import { App, Modal, Notice, Setting } from "obsidian";

import { IndexProfile } from "../../../../adapters/indexing/FileVectorIndexStore";
import { parseNonNegativeInteger, parsePositiveInteger } from "../../../../shared/numbers";
import {
  DEFAULT_INDEX_PROFILE,
  EmbeddingModelProfile,
  MAX_PROFILE_NAME_LENGTH,
  createIndexProfile,
  createProfileId,
  hasDuplicateProfileName,
  isValidIndexProfileName,
} from "../../../../adapters/settings/settings";
import { IndexPathPickerModal } from "./IndexPathPickerModal";
import { renderModalActions } from "./shared";

export interface IndexProfileModalOptions {
  profile?: IndexProfile;
  profiles: IndexProfile[];
  embeddingModels: EmbeddingModelProfile[];
  defaultEmbeddingModelProfileId?: string;
  onSave(profile: IndexProfile): Promise<void>;
}

export class IndexProfileModal extends Modal {
  private name = this.options.profile?.name ?? "";
  private mode: IndexProfile["mode"] = this.options.profile?.mode ?? "wholeVault";
  private includeFolders = [...(this.options.profile?.includeFolders ?? [])];
  private excludeGlobs = [...(this.options.profile?.excludeGlobs ?? [])];
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
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", {
      text: this.options.profile ? "Edit index profile" : "Add index profile",
    });

    new Setting(contentEl)
      .setName("Name")
      .setDesc(
        `Unique index name shown in settings, chat, and search selectors. Max ${MAX_PROFILE_NAME_LENGTH} characters.`,
      )
      .addText((text) => {
        text.inputEl.maxLength = MAX_PROFILE_NAME_LENGTH;
        text.setValue(this.name).onChange((value) => {
          this.name = value.trim();
        });
      });

    new Setting(contentEl)
      .setName("Mode")
      .setDesc(
        "Whole vault indexes every supported visible file except excluded paths; selected indexes only chosen paths.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("wholeVault", "Whole vault")
          .addOption("selected", "Selected")
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
        "Included",
        "Files and folders that should be included in this index.",
        this.includeFolders,
        (paths) => {
          this.includeFolders = paths;
          this.onOpen();
        },
      );
    } else {
      this.renderPathSetting(
        contentEl,
        "Excluded",
        "Files and folders that should be excluded from this whole-vault index.",
        this.excludeGlobs,
        (paths) => {
          this.excludeGlobs = paths;
          this.onOpen();
        },
      );
    }

    new Setting(contentEl)
      .setName("Embedding model")
      .setDesc("Embedding model used to generate vectors for this index.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Select embedding model");
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
      "Chunk size",
      "Maximum text chunk size for non-PDF files.",
      this.chunkSize,
      (value) => {
        this.chunkSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "Chunk overlap",
      "Number of characters shared between adjacent non-PDF chunks.",
      this.chunkOverlap,
      (value) => {
        this.chunkOverlap = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "Embedding batch size",
      "Number of chunks sent in one embedding request.",
      this.embeddingBatchSize,
      (value) => {
        this.embeddingBatchSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "PDF chunk size",
      "Maximum text chunk size for PDF files.",
      this.pdfChunkSize,
      (value) => {
        this.pdfChunkSize = value;
      },
    );
    this.renderNumberSetting(
      contentEl,
      "PDF chunk overlap",
      "Number of characters shared between adjacent PDF chunks.",
      this.pdfChunkOverlap,
      (value) => {
        this.pdfChunkOverlap = value;
      },
    );

    renderModalActions(contentEl, {
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
    new Setting(containerEl)
      .setName(name)
      .setDesc(description)
      .addButton((button) =>
        button.setButtonText("Choose").onClick(() => {
          new IndexPathPickerModal(this.app, {
            selectedPaths: paths,
            onSubmit: onChange,
          }).open();
        }),
      );
    const selectedEl = containerEl.createDiv({ cls: "ixplorer-index-path-summary" });
    if (paths.length === 0) {
      selectedEl.createDiv({
        cls: "ixplorer-index-path-summary__empty",
        text: "No paths selected",
      });
      return;
    }

    for (const path of paths) {
      selectedEl.createDiv({
        cls: "ixplorer-index-path-summary__item",
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
    const chunkSize = parsePositiveInteger(this.chunkSize);
    const chunkOverlap = parseNonNegativeInteger(this.chunkOverlap);
    const embeddingBatchSize = parsePositiveInteger(this.embeddingBatchSize);
    const pdfChunkSize = parsePositiveInteger(this.pdfChunkSize);
    const pdfChunkOverlap = parseNonNegativeInteger(this.pdfChunkOverlap);

    if (!isValidIndexProfileName(this.name)) {
      new Notice(
        "Use a unique name up to 60 characters with letters, numbers, spaces, _, -, ., (, ), [, ].",
      );
      return;
    }

    if (hasDuplicateProfileName(this.options.profiles, this.name, this.options.profile?.id)) {
      new Notice("Name must be unique.");
      return;
    }

    if (!this.embeddingModelProfileId) {
      new Notice("Select an embedding model.");
      return;
    }

    if (this.mode === "selected" && this.includeFolders.length === 0) {
      new Notice("Select at least one included path.");
      return;
    }

    if (
      chunkSize === null ||
      chunkOverlap === null ||
      embeddingBatchSize === null ||
      pdfChunkSize === null ||
      pdfChunkOverlap === null
    ) {
      new Notice("Numeric index settings must be valid whole numbers.");
      return;
    }

    const now = new Date().toISOString();
    const id = this.options.profile?.id ?? createProfileId("index");
    const profile = createIndexProfile({
      ...this.options.profile,
      id,
      name: this.name,
      mode: this.mode,
      indexFolder: this.options.profile?.indexFolder ?? `.ixplorer/indexes/${id}`,
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
      new Notice("Index settings changed. Rebuild this index to apply the new configuration.");
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
