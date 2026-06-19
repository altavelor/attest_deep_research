import { App, Modal, setIcon } from "obsidian";

import { ContextDiagnostics } from "../shared/types";
import { copyToClipboard } from "./clipboard";
import { formatDiagnosticReport } from "./diagnosticFormatting";

export class DiagnosticReportModalController {
  private modal: DiagnosticReportModal | null = null;

  constructor(private readonly app: App) {}

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
    this.modalEl.addClass("ixplorer-chat__diagnostic-modal");
    this.setTitle("Diagnostic report");
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-chat__diagnostic-modal-content");

    const copyButton = this.modalEl.createEl("button", {
      cls: "ixplorer-chat__diagnostic-modal-copy",
      attr: {
        type: "button",
        "aria-label": "Copy diagnostic report",
        title: "Copy diagnostic report",
      },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", () => {
      void copyToClipboard(report);
    });

    const closeButton = this.modalEl.querySelector(".modal-close-button");
    if (closeButton) {
      this.modalEl.insertBefore(copyButton, closeButton);
    }

    this.contentEl.createEl("pre", {
      cls: "ixplorer-chat__diagnostic-modal-report",
      text: report,
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.modalEl.removeClass("ixplorer-chat__diagnostic-modal");
  }
}
