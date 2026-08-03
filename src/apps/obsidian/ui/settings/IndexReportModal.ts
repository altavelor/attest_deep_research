import { App, Modal, Setting } from "obsidian";

import { IndexSourceReportItem } from "@adapters/indexing";
import { IndexProfile } from "@adapters/indexing";
import type { SourceDocumentMetadata, SourceDocumentSummaries } from "@application/ports";
import { sharedReferences } from "@application/use-cases/enrichment";
import { formatReportTimestamp } from "./indexPath";

export interface IndexReportModalOptions {
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
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", { text: `${this.options.profile.name} report` });

    const indexed = this.options.report.filter((item) => item.status === "indexed");
    const failed = this.options.report.filter((item) => item.status === "failed");
    const totalChunks = indexed.reduce((total, item) => total + item.chunkCount, 0);
    const metadata = this.options.metadata ?? [];
    const metadataBySourcePath = new Map(metadata.map((item) => [item.sourcePath, item]));
    const summariesBySourcePath = new Map(
      (this.options.summaries ?? []).map((item) => [item.sourcePath, item]),
    );
    const summary = contentEl.createDiv({ cls: "ixplorer-index-report__summary" });
    summary.createDiv({ text: `${indexed.length} indexed files` });
    summary.createDiv({ text: `${failed.length} failed files` });
    summary.createDiv({ text: `${totalChunks} chunks` });
    if (metadata.length > 0) {
      summary.createDiv({ text: `${metadata.length} enriched` });
    }

    this.renderIndexMetadataSection(contentEl, metadata);

    const list = contentEl.createDiv({ cls: "ixplorer-index-report__list" });
    if (this.options.report.length === 0) {
      list.createDiv({
        cls: "ixplorer-index-report__empty",
        text: "No indexing report is available yet.",
      });
    } else {
      for (const item of this.options.report) {
        const row = list.createDiv({
          cls: `ixplorer-index-report__row is-${item.status}`,
        });
        const title = row.createDiv({ cls: "ixplorer-index-report__path" });
        title.setText(item.sourcePath);
        title.setAttr("title", item.sourcePath);
        row.createDiv({
          cls: "ixplorer-index-report__status",
          text: item.status === "indexed" ? `${item.chunkCount} chunks` : "Failed",
        });
        row.createDiv({
          cls: "ixplorer-index-report__detail",
          text:
            item.status === "failed"
              ? (item.errorMessage ?? "Indexing failed.")
              : formatReportTimestamp(item.indexedAt),
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

    new Setting(contentEl).setClass("ixplorer-profile-modal__actions").addButton((button) =>
      button
        .setCta()
        .setButtonText("Close")
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

    const details = containerEl.createEl("details", { cls: "ixplorer-index-report__section" });
    details.createEl("summary", { text: "Index metadata" });
    const body = details.createDiv({ cls: "ixplorer-index-report__section-body" });

    const models = [...new Set(metadata.map((item) => item.extraction.model))];
    const lastExtractedAt = metadata
      .map((item) => item.extraction.extractedAt)
      .sort()
      .at(-1);
    const totalReferences = metadata.reduce((total, item) => total + item.references.length, 0);
    const facts = body.createDiv({ cls: "ixplorer-index-report__facts" });
    facts.createDiv({ text: `Extraction model: ${models.join(", ")}` });
    if (lastExtractedAt) {
      facts.createDiv({ text: `Last extracted: ${formatReportTimestamp(lastExtractedAt)}` });
    }
    facts.createDiv({ text: `References collected: ${totalReferences}` });

    const shared = sharedReferences(metadata, 2).slice(0, SHARED_REFERENCES_SHOWN);
    if (shared.length > 0) {
      body.createDiv({
        cls: "ixplorer-index-report__facts-heading",
        text: "Shared references (cited by several documents):",
      });
      for (const reference of shared) {
        const line = body.createDiv({ cls: "ixplorer-index-report__reference" });
        line.setText(`${reference.citedBy.length}× — ${reference.reference}`);
        line.setAttr("title", `Cited by: ${reference.citedBy.join(", ")}`);
      }
    }
  }

  private renderSourceMetadata(row: HTMLElement, metadata: SourceDocumentMetadata): void {
    const details = row.createEl("details", { cls: "ixplorer-index-report__section" });
    details.createEl("summary", { text: metadataSummaryLine(metadata) });
    const body = details.createDiv({ cls: "ixplorer-index-report__section-body" });

    if (metadata.authors && metadata.authors.length > 0) {
      body.createDiv({ text: `Authors: ${metadata.authors.join(", ")}` });
    }
    if (metadata.abstract) {
      body.createDiv({ cls: "ixplorer-index-report__abstract", text: metadata.abstract });
    }
    if (metadata.references.length > 0) {
      body.createDiv({
        cls: "ixplorer-index-report__facts-heading",
        text: `References (${metadata.references.length}):`,
      });
      for (const reference of metadata.references) {
        body.createDiv({ cls: "ixplorer-index-report__reference", text: reference.raw });
      }
    }
  }

  private renderSourceSummaries(row: HTMLElement, summaries: SourceDocumentSummaries): void {
    const details = row.createEl("details", { cls: "ixplorer-index-report__section" });
    details.createEl("summary", {
      text: `Summary · ${summaries.sections.length} sections`,
    });
    const body = details.createDiv({ cls: "ixplorer-index-report__section-body" });
    body.createDiv({ cls: "ixplorer-index-report__abstract", text: summaries.document.summary });
    for (const section of summaries.sections) {
      body.createDiv({
        cls: "ixplorer-index-report__reference",
        text: `${section.headingPath.join(" > ")}: ${section.summary}`,
      });
    }
  }
}

function metadataSummaryLine(metadata: SourceDocumentMetadata): string {
  const parts = [
    metadata.title ?? "Metadata",
    ...(metadata.year ? [String(metadata.year)] : []),
    `${metadata.references.length} refs`,
  ];
  return parts.join(" · ");
}
