import { App, Modal, Setting } from "obsidian";

import { IndexSourceReportItem } from "@adapters/indexing";
import { IndexProfile } from "@adapters/indexing";
import { formatReportTimestamp } from "./indexPath";

export interface IndexReportModalOptions {
  profile: IndexProfile;
  report: IndexSourceReportItem[];
}

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
    const summary = contentEl.createDiv({ cls: "ixplorer-index-report__summary" });
    summary.createDiv({ text: `${indexed.length} indexed files` });
    summary.createDiv({ text: `${failed.length} failed files` });
    summary.createDiv({ text: `${totalChunks} chunks` });

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
}
