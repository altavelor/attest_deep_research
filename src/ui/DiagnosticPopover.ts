import { setIcon } from "obsidian";

import { ContextDiagnostics } from "../shared/types";
import { copyToClipboard } from "./clipboard";
import { formatDiagnosticReport } from "./diagnosticFormatting";

export interface DiagnosticPopoverControllerOptions {
  hostEl: HTMLElement;
}

export class DiagnosticPopoverController {
  private readonly hostEl: HTMLElement;
  private popoverEl: HTMLElement | null = null;
  private anchorEl: HTMLElement | null = null;
  private readonly handleOutsidePointer = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (this.popoverEl?.contains(target) || this.anchorEl?.contains(target)) {
      return;
    }
    this.close();
  };

  constructor(options: DiagnosticPopoverControllerOptions) {
    this.hostEl = options.hostEl;
  }

  open(anchorEl: HTMLElement, diagnostics: ContextDiagnostics): void {
    this.close();
    this.anchorEl = anchorEl;
    const report = formatDiagnosticReport(diagnostics);
    const popover = this.hostEl.createDiv({
      cls: "ixplorer-chat__diagnostic-popover",
      attr: {
        role: "dialog",
        "aria-label": "Diagnostic report",
      },
    });
    const header = popover.createDiv({ cls: "ixplorer-chat__diagnostic-popover-header" });
    header.createEl("h3", { text: "Diagnostic report" });
    const actions = header.createDiv({ cls: "ixplorer-chat__diagnostic-popover-actions" });
    const copyButton = actions.createEl("button", {
      cls: "ixplorer-chat__diagnostic-popover-copy",
      attr: {
        type: "button",
        "aria-label": "Copy diagnostic report",
        title: "Copy diagnostic report",
      },
    });
    setIcon(copyButton, "copy");
    copyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void copyToClipboard(report);
    });
    const closeButton = actions.createEl("button", {
      cls: "ixplorer-chat__diagnostic-popover-close",
      attr: {
        type: "button",
        "aria-label": "Close diagnostic report",
        title: "Close diagnostic report",
      },
    });
    setIcon(closeButton, "x");
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.close();
      anchorEl.focus();
    });
    popover.createEl("pre", {
      cls: "ixplorer-chat__diagnostic-popover-report",
      text: report,
    });

    this.popoverEl = popover;
    this.position(anchorEl, popover);
    document.addEventListener("pointerdown", this.handleOutsidePointer, true);
  }

  close(): void {
    document.removeEventListener("pointerdown", this.handleOutsidePointer, true);
    this.popoverEl?.remove();
    this.popoverEl = null;
    this.anchorEl = null;
  }

  private position(anchorEl: HTMLElement, popoverEl: HTMLElement): void {
    const anchorRect = anchorEl.getBoundingClientRect();
    const hostRect = this.hostEl.getBoundingClientRect();
    const popoverRect = popoverEl.getBoundingClientRect();
    const gap = 8;
    const left = Math.min(
      Math.max(anchorRect.right - hostRect.left - popoverRect.width, gap),
      Math.max(gap, hostRect.width - popoverRect.width - gap),
    );
    const topBelow = anchorRect.bottom - hostRect.top + gap;
    const topAbove = anchorRect.top - hostRect.top - popoverRect.height - gap;
    const top =
      topBelow + popoverRect.height <= hostRect.height || topAbove < gap
        ? topBelow
        : Math.max(gap, topAbove);

    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${top}px`;
  }
}
