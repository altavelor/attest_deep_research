import { App, Modal, Setting, ToggleComponent, setIcon } from "obsidian";

import { IndexProfile } from "@adapters/indexing";
import { ChatModelProfile, EmbeddingModelProfile } from "@adapters/settings";

/** What the user asked the run to do; sections run sequentially when both are on. */
export interface IndexRunPlan {
  mode: "start" | "update" | "rebuild";
  embedding?: { embeddingModelProfileId: string };
  metadata?: { chatModelProfileId: string; force?: boolean };
}

export interface IndexRunModalOptions {
  profile: IndexProfile;
  /** Whether metadata sidecars already exist for this index. */
  hasMetadata: boolean;
  embeddingModels: EmbeddingModelProfile[];
  chatModels: ChatModelProfile[];
  defaultChatModelProfileId: string;
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
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", {
      text: this.indexExists()
        ? `Update “${this.options.profile.name}”`
        : `Index “${this.options.profile.name}”`,
    });

    this.renderEmbeddingSection(contentEl);
    this.renderAdvancedSection(contentEl);
    this.warningEl = contentEl.createDiv({ cls: "ixplorer-index-run__warning" });
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
    const section = containerEl.createDiv({ cls: "ixplorer-index-run__section" });
    new Setting(section)
      .setName("Index content (embedding model)")
      .setDesc("Extract, chunk, and embed vault files into the index.")
      .addToggle((toggle) =>
        toggle.setValue(this.embeddingEnabled).onChange((value) => {
          this.embeddingEnabled = value;
          if (!value && !this.indexExists()) {
            this.metadataEnabled = false;
          }
          this.refresh();
        }),
      );
    new Setting(section).setName("Embedding model").addDropdown((dropdown) => {
      for (const profile of this.options.embeddingModels) {
        dropdown.addOption(profile.id, `${profile.name} (${profile.modelName})`);
      }
      dropdown.setValue(this.embeddingModelProfileId).onChange((value) => {
        this.embeddingModelProfileId = value;
        this.refresh();
      });
    });
  }

  private renderAdvancedSection(containerEl: HTMLElement): void {
    const details = containerEl.createEl("details", { cls: "ixplorer-index-run__advanced" });
    details.open = this.metadataEnabled;
    details.createEl("summary", {
      cls: "ixplorer-index-run__advanced-summary",
      text: "Advanced",
    });
    const content = details.createDiv({ cls: "ixplorer-index-run__advanced-content" });

    const warning = content.createDiv({ cls: "ixplorer-index-run__token-warning" });
    setIcon(
      warning.createSpan({ cls: "ixplorer-index-run__token-warning-icon" }),
      "alert-triangle",
    );
    warning.createSpan({
      text: "Metadata extraction can take a long time and consume a large number of tokens.",
    });

    this.renderMetadataSection(content);
  }

  private renderMetadataSection(containerEl: HTMLElement): void {
    const section = containerEl.createDiv({ cls: "ixplorer-index-run__section" });
    this.metadataSectionEl = section;
    new Setting(section)
      .setName("Extract metadata & summaries (chat model)")
      .setDesc(
        "Extract title, authors, year, abstract, and references, and generate section and document summaries for every document. Unchanged documents are skipped.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.metadataEnabled).onChange((value) => {
          this.metadataEnabled = value;
          this.refresh();
        });
        this.metadataToggle = toggle;
      });
    new Setting(section).setName("Metadata model").addDropdown((dropdown) => {
      for (const profile of this.options.chatModels) {
        dropdown.addOption(profile.id, `${profile.name} (${profile.modelName})`);
      }
      dropdown.setValue(this.chatModelProfileId).onChange((value) => {
        this.chatModelProfileId = value;
      });
    });
    if (this.options.hasMetadata) {
      new Setting(section)
        .setName("Re-extract unchanged documents")
        .setDesc("Ignore stored metadata and run extraction for every document again.")
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
      if (this.embeddingModelChanged()) {
        this.warningEl.setText(
          "Changing the embedding model requires a full re-index: running this will rebuild the index (and its metadata) from scratch.",
        );
      }
    }

    this.renderFooter();
  }

  private renderFooter(): void {
    if (!this.footerEl) {
      return;
    }
    this.footerEl.empty();
    const actions = new Setting(this.footerEl)
      .setClass("ixplorer-profile-modal__actions")
      .setClass("ixplorer-index-run__actions");

    if (!this.indexExists()) {
      actions.addButton((button) => {
        button
          .setCta()
          .setButtonText("Start")
          .setDisabled(!this.embeddingEnabled)
          .onClick(() => this.submit("start"));
      });
      return;
    }

    actions.addButton((button) => {
      button
        .setButtonText("Rebuild")
        .setDisabled(!this.embeddingEnabled)
        .onClick(() => this.submit("rebuild"));
    });
    actions.addButton((button) => {
      button
        .setCta()
        .setButtonText("Update")
        .setDisabled(!this.embeddingEnabled && !this.metadataEnabled)
        .onClick(() => this.submit("update"));
    });
  }

  private submit(mode: IndexRunPlan["mode"]): void {
    const effectiveMode = mode !== "start" && this.embeddingModelChanged() ? "rebuild" : mode;
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
