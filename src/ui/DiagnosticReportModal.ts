import { App, Modal, setIcon } from "obsidian";

import { ContextDiagnostics } from "../shared/types";
import { copyToClipboard } from "./clipboard";
import { formatDiagnosticReport } from "./diagnosticFormatting";
import { buildDiagnosticReportViewModel } from "./diagnosticFormatting";
import { formatDiagnosticReportHtml } from "./diagnosticHtml";
import { downloadDiagnosticHtml } from "./diagnosticDownload";
import { renderReadableDiagnosticReport } from "./diagnosticReadable";

export class DiagnosticReportModalController {
  private modal: DiagnosticReportModal | null = null;

  constructor(private readonly app: App) { }

  open(diagnostics: ContextDiagnostics): void {
    this.close();
    this.modal = new DiagnosticReportModal(this.app, diagnostics);
    this.modal.open();
  }

  close(): void {
    this.modal?.close();
    this.modal = null;
  }
}

class DiagnosticReportModal extends Modal {
  constructor(
    app: App,
    private readonly diagnostics: ContextDiagnostics,
  ) {
    super(app);
  }

  onOpen(): void {
    const report = formatDiagnosticReport(this.diagnostics);
    const viewModel = buildDiagnosticReportViewModel(this.diagnostics);
    const readableHtml = formatDiagnosticReportHtml(this.diagnostics);
    this.modalEl.addClass("ixplorer-chat__diagnostic-modal");
    this.setTitle("Diagnostic report");
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-chat__diagnostic-modal-content");

    const toolbar = this.modalEl.createDiv({ cls: "ixplorer-chat__diagnostic-modal-toolbar" });
    const modeSwitch = toolbar.createDiv({
      cls: "ixplorer-chat__diagnostic-mode-switch",
      attr: { role: "group", "aria-label": "Diagnostic report view" },
    });
    const readableButton = modeSwitch.createEl("button", {
      text: "Readable",
      cls: "is-active",
      attr: { type: "button", "aria-pressed": "true" },
    });
    const rawButton = modeSwitch.createEl("button", {
      text: "Raw",
      attr: { type: "button", "aria-pressed": "false" },
    });
    const copyButton = toolbar.createEl("button", {
      attr: {
        type: "button",
        "aria-label": "Copy raw report",
        title: "Copy raw report",
      },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void copyToClipboard(report);
    });
    const downloadButton = toolbar.createEl("button", {
      attr: {
        type: "button",
        "aria-label": "Download readable HTML",
        title: "Download readable HTML",
      },
    });
    setIcon(downloadButton, "download");
    downloadButton.addEventListener("click", () => {
      downloadDiagnosticHtml(readableHtml, viewModel.identity.runId);
    });

    const closeButton = this.modalEl.querySelector(".modal-close-button");
    if (closeButton) {
      this.modalEl.insertBefore(toolbar, closeButton);
    }

    const readablePanel = this.contentEl.createDiv({
      cls: "ixplorer-chat__diagnostic-readable",
    });
    renderReadableDiagnosticReport(readablePanel, viewModel);
    const rawPanel = this.contentEl.createEl("pre", {
      cls: "ixplorer-chat__diagnostic-modal-report",
      text: report,
    });
    rawPanel.hidden = true;
    let readableScrollTop = 0;
    let rawScrollTop = 0;
    const selectMode = (mode: "readable" | "raw") => {
      if (mode === "readable") {
        rawScrollTop = rawPanel.scrollTop;
        rawPanel.hidden = true;
        readablePanel.hidden = false;
        readablePanel.scrollTop = readableScrollTop;
      } else {
        readableScrollTop = readablePanel.scrollTop;
        readablePanel.hidden = true;
        rawPanel.hidden = false;
        rawPanel.scrollTop = rawScrollTop;
      }
      readableButton.toggleClass("is-active", mode === "readable");
      rawButton.toggleClass("is-active", mode === "raw");
      readableButton.setAttribute("aria-pressed", String(mode === "readable"));
      rawButton.setAttribute("aria-pressed", String(mode === "raw"));
    };
    readableButton.addEventListener("click", () => selectMode("readable"));
    rawButton.addEventListener("click", () => selectMode("raw"));
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass("ixplorer-chat__diagnostic-modal");
  }
}
