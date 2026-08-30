import { App, Modal, Setting } from "obsidian";

import { IndexSourceReportItem } from "@adapters/indexing";
import { IndexProfile } from "@adapters/indexing";
import type { SourceDocumentMetadata, SourceDocumentSummaries } from "@application/ports";
import { sharedReferences } from "@application/use-cases/enrichment";
import type { Translate } from "@adapters/i18n";
import { DEFAULT_LOCALE } from "@core/i18n";
import type { LocaleCode, TextDirection } from "@core/i18n";
import { formatReportTimestamp } from "./indexPath";

export interface IndexReportModalOptions {
  t: Translate;
  getDirection?(): TextDirection;
  getLocale?(): LocaleCode;
  profile: IndexProfile;
  report: IndexSourceReportItem[];

  metadata?: SourceDocumentMetadata[];
  summaries?: SourceDocumentSummaries[];
}

const SHARED_REFERENCES_SHOWN = 10;

export class IndexReportModal extends Modal {
  constructor(
    app: App,
    private readonly options: IndexReportModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    const { contentEl } = this;
    const { t } = this.options;
    contentEl.empty();
    this.modalEl.addClass("attest-profile-modal-host");
    contentEl.addClass("attest-profile-modal");
    contentEl.createEl("h2", {
      text: t("settings.indexReport.title", { profile: this.options.profile.name }),
    });

    const indexed = this.options.report.filter((item) => item.status === "indexed");
    const failed = this.options.report.filter((item) => item.status === "failed");
    const totalChunks = indexed.reduce((total, item) => total + item.chunkCount, 0);
    const metadata = this.options.metadata ?? [];
    const metadataBySourcePath = new Map(metadata.map((item) => [item.sourcePath, item]));
    const summariesBySourcePath = new Map(
      (this.options.summaries ?? []).map((item) => [item.sourcePath, item]),
    );
    const summary = contentEl.createDiv({ cls: "attest-index-report__summary" });
    summary.createDiv({ text: t("settings.indexReport.indexedFiles", { count: indexed.length }) });
    summary.createDiv({ text: t("settings.indexReport.failedFiles", { count: failed.length }) });
    summary.createDiv({ text: t("settings.indexReport.chunks", { count: totalChunks }) });
    if (metadata.length > 0) {
      summary.createDiv({ text: t("settings.indexReport.enriched", { count: metadata.length }) });
    }

    this.renderIndexMetadataSection(contentEl, metadata);

    const list = contentEl.createDiv({ cls: "attest-index-report__list" });
    if (this.options.report.length === 0) {
      list.createDiv({
        cls: "attest-index-report__empty",
        text: t("settings.indexReport.empty"),
      });
    } else {
      for (const item of this.options.report) {
        const row = list.createDiv({
          cls: `attest-index-report__row is-${item.status}`,
        });
        const title = row.createDiv({ cls: "attest-index-report__path" });
        title.setText(item.sourcePath);
        title.setAttr("title", item.sourcePath);
        row.createDiv({
          cls: "attest-index-report__status",
          text:
            item.status === "indexed"
              ? t("settings.indexReport.chunks", { count: item.chunkCount })
              : t("settings.indexReport.failed"),
        });
        row.createDiv({
          cls: "attest-index-report__detail",
          text:
            item.status === "failed"
              ? (item.errorMessage ?? t("settings.indexReport.indexingFailed"))
              : formatReportTimestamp(item.indexedAt, this.options.getLocale?.() ?? DEFAULT_LOCALE),
        });
        const sourceMetadata = metadataBySourcePath.get(item.sourcePath);
        if (sourceMetadata) {
          this.renderSourceMetadata(row, sourceMetadata);
        }
        const sourceSummaries = summariesBySourcePath.get(item.sourcePath);
        if (sourceSummaries) {
          this.renderSourceSummaries(row, sourceSummaries);
        }
      }
    }

    new Setting(contentEl).setClass("attest-profile-modal__actions").addButton((button) =>
      button
        .setCta()
        .setButtonText(t("common.close"))
        .onClick(() => this.close()),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** Index-wide metadata: extraction provenance and the shared bibliography. */
  private renderIndexMetadataSection(
    containerEl: HTMLElement,
    metadata: SourceDocumentMetadata[],
  ): void {
    if (metadata.length === 0) {
      return;
    }

    const { t } = this.options;
    const details = containerEl.createEl("details", { cls: "attest-index-report__section" });
    details.createEl("summary", { text: t("settings.indexReport.metadataSection") });
    const body = details.createDiv({ cls: "attest-index-report__section-body" });

    const models = [...new Set(metadata.map((item) => item.extraction.model))];
    const lastExtractedAt = metadata
      .map((item) => item.extraction.extractedAt)
      .sort()
      .at(-1);
    const totalReferences = metadata.reduce((total, item) => total + item.references.length, 0);
    const facts = body.createDiv({ cls: "attest-index-report__facts" });
    facts.createDiv({
      text: t("settings.indexReport.extractionModel", { models: models.join(", ") }),
    });
    if (lastExtractedAt) {
      facts.createDiv({
        text: t("settings.indexReport.lastExtracted", {
          timestamp: formatReportTimestamp(
            lastExtractedAt,
            this.options.getLocale?.() ?? DEFAULT_LOCALE,
          ),
        }),
      });
    }
    facts.createDiv({
      text: t("settings.indexReport.referencesCollected", { count: totalReferences }),
    });

    const shared = sharedReferences(metadata, 2).slice(0, SHARED_REFERENCES_SHOWN);
    if (shared.length > 0) {
      body.createDiv({
        cls: "attest-index-report__facts-heading",
        text: t("settings.indexReport.sharedReferences"),
      });
      for (const reference of shared) {
        const line = body.createDiv({ cls: "attest-index-report__reference" });
        line.setText(
          t("settings.indexReport.sharedReference", {
            count: reference.citedBy.length,
            reference: reference.reference,
          }),
        );
        line.setAttr(
          "title",
          t("settings.indexReport.citedBy", { sources: reference.citedBy.join(", ") }),
        );
      }
    }
  }

  private renderSourceMetadata(row: HTMLElement, metadata: SourceDocumentMetadata): void {
    const { t } = this.options;
    const details = row.createEl("details", { cls: "attest-index-report__section" });
    details.createEl("summary", { text: metadataSummaryLine(t, metadata) });
    const body = details.createDiv({ cls: "attest-index-report__section-body" });

    if (metadata.authors && metadata.authors.length > 0) {
      body.createDiv({
        text: t("settings.indexReport.authors", { authors: metadata.authors.join(", ") }),
      });
    }
    if (metadata.abstract) {
      body.createDiv({ cls: "attest-index-report__abstract", text: metadata.abstract });
    }
    if (metadata.references.length > 0) {
      body.createDiv({
        cls: "attest-index-report__facts-heading",
        text: t("settings.indexReport.references", { count: metadata.references.length }),
      });
      for (const reference of metadata.references) {
        body.createDiv({ cls: "attest-index-report__reference", text: reference.raw });
      }
    }
  }

  private renderSourceSummaries(row: HTMLElement, summaries: SourceDocumentSummaries): void {
    const { t } = this.options;
    const details = row.createEl("details", { cls: "attest-index-report__section" });
    details.createEl("summary", {
      text: t("settings.indexReport.summary", { count: summaries.sections.length }),
    });
    const body = details.createDiv({ cls: "attest-index-report__section-body" });
    body.createDiv({ cls: "attest-index-report__abstract", text: summaries.document.summary });
    for (const section of summaries.sections) {
      body.createDiv({
        cls: "attest-index-report__reference",
        text: t("settings.indexReport.section", {
          heading: section.headingPath.join(" > "),
          summary: section.summary,
        }),
      });
    }
  }
}

function metadataSummaryLine(t: Translate, metadata: SourceDocumentMetadata): string {
  const parts = [
    metadata.title ?? t("settings.indexReport.metadataFallbackTitle"),
    ...(metadata.year ? [String(metadata.year)] : []),
    t("settings.indexReport.refs", { count: metadata.references.length }),
  ];
  return parts.join(" · ");
}
