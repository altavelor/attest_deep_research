import { Modal, Platform, type App } from "obsidian";

import { ModalResizeController } from "./ModalResizeController";
import {
  SubAgentSessionsController,
  type SubAgentSessionsControllerOptions,
} from "./SubAgentSessionsController";

export type SubAgentSessionsModalOptions = Omit<
  SubAgentSessionsControllerOptions,
  "app" | "setTitle"
> & {
  direction: "ltr" | "rtl";
  initialSessionId?: string;
  onClosed(): void;
};

/** Obsidian modal shell of the sub-agent sessions; the controller owns its content and lifecycle. */
export class SubAgentSessionsModal extends Modal {
  private readonly controller: SubAgentSessionsController;
  private resizer: ModalResizeController | null = null;

  constructor(
    app: App,
    private readonly modalOptions: SubAgentSessionsModalOptions,
  ) {
    super(app);
    this.controller = new SubAgentSessionsController({
      ...modalOptions,
      app,
      setTitle: (title) => this.titleEl.setText(title),
    });
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.modalOptions.direction);
    this.modalEl.addClass("attest-sub-agents-modal");
    if (!Platform.isMobile) {
      this.resizer = new ModalResizeController(this.modalEl, this.app, this.modalOptions.t);
      this.resizer.attach();
    }
    this.controller.mount(this.contentEl, this.modalOptions.initialSessionId);
  }

  onClose(): void {
    this.resizer?.dispose();
    this.resizer = null;
    this.controller.dispose();
    this.contentEl.empty();
    this.modalOptions.onClosed();
  }

  navigate(sessionId?: string): void {
    this.controller.navigate(sessionId);
  }

  focus(): void {
    this.controller.focus();
  }

  setDebugMode(debug: boolean): void {
    this.controller.setDebugMode(debug);
  }
}
