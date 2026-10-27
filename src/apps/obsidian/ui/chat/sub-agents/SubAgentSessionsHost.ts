import type { App } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type { SubAgentInspectionPort } from "@application/ports/subAgent";
import { SubAgentCountTracker } from "./SubAgentCountTracker";
import { SubAgentSessionsModal } from "./SubAgentSessionsModal";

export interface SubAgentSessionsHostOptions {
  app: App;
  t: Translate;
  getPort(chatSessionId: string): SubAgentInspectionPort | null;
  getChatTitle(chatSessionId: string): string;
  getDirection(): "ltr" | "rtl";
  isDebugMode(): boolean;
  notify(message: string): void;
  onCountChange(): void;
  restoreFocus(): void;
}

/**
 * Binds the agents button and the sessions modal to the chat the view displays. Switching
 * or deleting that chat closes its modal, and focus returns to the new chat's composer
 * once it is rendered and its first snapshot is known.
 */
export class SubAgentSessionsHost {
  private readonly tracker: SubAgentCountTracker;
  private modal: { chatSessionId: string; modal: SubAgentSessionsModal } | null = null;
  private focusPending = false;
  private composerReady = true;

  constructor(private readonly options: SubAgentSessionsHostOptions) {
    this.tracker = new SubAgentCountTracker(() => {
      options.onCountChange();
      this.flushFocus();
    });
  }

  get activeCount(): number {
    return this.tracker.activeCount;
  }

  get hasAgentRuns(): boolean {
    return this.tracker.hasAgentRuns;
  }

  select(chatSessionId: string): void {
    const switched = this.tracker.boundChat !== chatSessionId;
    if (switched && this.modal) {
      this.closeModal();
      this.focusPending = true;
      this.composerReady = false;
    }
    this.tracker.bind(chatSessionId, this.options.getPort(chatSessionId));
  }

  open(sessionId?: string): void {
    const chatSessionId = this.tracker.boundChat;
    if (chatSessionId === null) return;
    if (this.modal?.chatSessionId === chatSessionId) {
      if (sessionId !== undefined) this.modal.modal.navigate(sessionId);
      this.modal.modal.focus();
      return;
    }
    const port = this.options.getPort(chatSessionId);
    if (!port) return;
    const modal = new SubAgentSessionsModal(this.options.app, {
      port,
      t: this.options.t,
      chatTitle: this.options.getChatTitle(chatSessionId),
      debug: this.options.isDebugMode(),
      direction: this.options.getDirection(),
      ...(sessionId !== undefined ? { initialSessionId: sessionId } : {}),
      onStopFailedOutside: (message) => this.options.notify(message),
      onClosed: () => {
        if (this.modal?.modal === modal) this.modal = null;
      },
    });
    this.modal = { chatSessionId, modal };
    modal.open();
  }

  closeForChat(chatSessionId: string): void {
    if (this.modal?.chatSessionId === chatSessionId) this.closeModal();
  }

  setDebugMode(debug: boolean): void {
    this.modal?.modal.setDebugMode(debug);
  }

  composerRendered(): void {
    this.composerReady = true;
    this.flushFocus();
  }

  dispose(): void {
    this.closeModal();
    this.tracker.release();
    this.focusPending = false;
  }

  private closeModal(): void {
    const current = this.modal;
    this.modal = null;
    current?.modal.close();
  }

  private flushFocus(): void {
    if (!this.focusPending || !this.composerReady || !this.tracker.loaded) return;
    this.focusPending = false;
    this.options.restoreFocus();
  }
}
