import { Component, type App } from "obsidian";

import type { Translate } from "@adapters/i18n";
import type {
  SubAgentInspectionDetail,
  SubAgentInspectionSnapshot,
  SubAgentSessionCard,
} from "@application/contracts/subAgentInspection";
import type { SubAgentInspectionPort } from "@application/ports/subAgent";
import { formatElapsed, liveElapsed } from "./format";
import { SessionDetailView } from "./sessionDetail";
import {
  renderEmptyState,
  renderSessionList,
  SESSION_PAGE_SIZE,
  type RenderedSessionList,
} from "./sessionList";
import type { StopState } from "./stopArea";

export interface SubAgentSessionsControllerOptions {
  port: SubAgentInspectionPort;
  app: App;
  t: Translate;
  chatTitle: string;
  debug: boolean;
  setTitle(title: string): void;
  onStopFailedOutside(message: string): void;
  now?: () => number;
}

type Route = { kind: "list" } | { kind: "detail"; sessionId: string };

const TICK_MS = 1000;

/**
 * Owns the sessions modal's content: one subscription to the chat's scoped inspection
 * port, the list and details routes, the stop flow and one elapsed timer that runs only
 * while something is running. Disposing it releases everything and fences late callbacks
 * but never stops an agent.
 */
export class SubAgentSessionsController {
  private readonly component = new Component();
  private readonly now: () => number;
  private bodyEl: HTMLElement | null = null;
  private route: Route = { kind: "list" };
  private snapshot: SubAgentInspectionSnapshot | null = null;
  private snapshotAt = 0;
  private listFailed = false;
  private limit = SESSION_PAGE_SIZE;
  private list: RenderedSessionList | null = null;
  private listScroll = 0;
  private returnFocusTo: string | null = null;
  private detailView: SessionDetailView | null = null;
  private detail: SubAgentInspectionDetail | null = null;
  private detailAt = 0;
  private routeToken = 0;
  private detailInFlight: number | null = null;
  private detailAgain = false;
  private selectedRunId: string | null = null;
  private readonly stops = new Map<string, StopState>();
  private readonly stopping = new Set<string>();
  private debug: boolean;
  private timer: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: SubAgentSessionsControllerOptions) {
    this.now = options.now ?? (() => performance.now());
    this.debug = options.debug;
  }

  mount(contentEl: HTMLElement, sessionId?: string): void {
    void this.component.load();
    this.bodyEl = contentEl.createDiv({ cls: "attest-sub-agents" });
    this.unsubscribe = this.options.port.subscribe((snapshot) => this.accept(snapshot));
    this.navigate(sessionId);
    if (!this.snapshot) this.loadSnapshot();
  }

  navigate(sessionId?: string): void {
    if (this.disposed) return;
    if (sessionId === undefined) this.showList();
    else this.showDetail(sessionId);
  }

  focus(): void {
    if (this.route.kind === "detail") this.detailView?.focusBack();
    else this.list?.headingEl.focus();
  }

  setDebugMode(debug: boolean): void {
    if (this.debug === debug) return;
    this.debug = debug;
    this.renderDetail();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setTimer(false);
    this.leaveDetail();
    this.component.unload();
    this.bodyEl?.empty();
    this.bodyEl = null;
  }

  private loadSnapshot(): void {
    const generation = this.generation;
    this.listFailed = false;
    if (this.route.kind === "list") this.renderList();
    this.options.port.snapshot().then(
      (snapshot) => {
        if (generation === this.generation) this.accept(snapshot);
      },
      () => {
        if (generation !== this.generation || this.snapshot) return;
        this.listFailed = true;
        if (this.route.kind === "list") this.renderList();
      },
    );
  }

  private accept(snapshot: SubAgentInspectionSnapshot): void {
    if (this.disposed) return;
    if (this.snapshot && snapshot.revision < this.snapshot.revision) return;
    this.snapshot = snapshot;
    this.snapshotAt = this.now();
    this.listFailed = false;
    if (this.route.kind === "list") this.renderList();
    else this.refreshDetail();
  }

  private showList(): void {
    const from = this.route.kind === "detail" ? this.route.sessionId : null;
    this.leaveDetail();
    this.route = { kind: "list" };
    this.options.setTitle(this.options.t("chat.subAgents.title"));
    if (from) this.returnFocusTo = from;
    this.renderList(true);
  }

  private renderList(restoreSaved = false): void {
    const bodyEl = this.bodyEl;
    if (!bodyEl) return;
    const { t } = this.options;
    const focused = this.focusedSession();
    const scroll = restoreSaved ? this.listScroll : bodyEl.scrollTop;
    bodyEl.empty();
    this.list = null;
    if (!this.snapshot) {
      this.renderListPlaceholder(bodyEl);
      this.setTimer(false);
      return;
    }
    this.list = renderSessionList(bodyEl, {
      snapshot: this.snapshot,
      chatTitle: this.options.chatTitle,
      limit: this.limit,
      t,
      elapsedOf: (card) => this.elapsedOf(card, this.snapshotAt),
      onSelect: (sessionId) => this.showDetail(sessionId),
      onShowMore: () => {
        this.limit += SESSION_PAGE_SIZE;
        this.renderList();
      },
    });
    bodyEl.scrollTop = scroll;
    const target = this.returnFocusTo ?? focused;
    this.returnFocusTo = null;
    if (target !== null) (this.list.cards.get(target) ?? this.list.headingEl).focus();
    this.setTimer(this.snapshot.sessions.some((card) => card.status === "running"));
  }

  private renderListPlaceholder(bodyEl: HTMLElement): void {
    const { t } = this.options;
    if (!this.listFailed) {
      const loadingEl = bodyEl.createDiv({ cls: "attest-sub-agents__loading" });
      for (let index = 0; index < 3; index += 1) {
        loadingEl.createDiv({ cls: "attest-sub-agents__skeleton" });
      }
      loadingEl.createDiv({ text: t("chat.subAgents.loading"), attr: { role: "status" } });
      return;
    }
    this.renderReadError(() => this.loadSnapshot());
  }

  private renderReadError(retry: () => void): void {
    const bodyEl = this.bodyEl;
    if (!bodyEl) return;
    const { t } = this.options;
    bodyEl.empty();
    const errorEl = bodyEl.createDiv({ cls: "attest-sub-agents__error", attr: { role: "alert" } });
    errorEl.createDiv({
      cls: "attest-sub-agents__error-title",
      text: t("chat.subAgents.error.title"),
    });
    errorEl.createDiv({ text: t("chat.subAgents.error.body") });
    const retryEl = errorEl.createEl("button", {
      text: t("chat.subAgents.retry"),
      attr: { type: "button" },
    });
    retryEl.addEventListener("click", retry);
  }

  private focusedSession(): string | null {
    const active = this.bodyEl?.ownerDocument.activeElement;
    if (!(active instanceof HTMLElement) || !this.bodyEl?.contains(active)) return null;
    return active.dataset.sessionId ?? null;
  }

  private showDetail(sessionId: string): void {
    if (this.route.kind === "list" && this.bodyEl) this.listScroll = this.bodyEl.scrollTop;
    this.leaveDetail();
    this.route = { kind: "detail", sessionId };
    this.options.setTitle("");
    this.list = null;
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.renderBackOnly(this.bodyEl);
    this.bodyEl.createDiv({
      text: this.options.t("chat.subAgents.loading"),
      attr: { role: "status" },
    });
    this.refreshDetail();
  }

  private leaveDetail(): void {
    this.routeToken += 1;
    this.detailInFlight = null;
    this.detailAgain = false;
    this.detailView?.dispose();
    this.detailView = null;
    this.detail = null;
    this.selectedRunId = null;
  }

  private refreshDetail(): void {
    if (this.disposed || this.route.kind !== "detail") return;
    const token = this.routeToken;
    if (this.detailInFlight === token) {
      this.detailAgain = true;
      return;
    }
    const sessionId = this.route.sessionId;
    this.detailInFlight = token;
    const settle = (detail: SubAgentInspectionDetail | null, failed: boolean): void => {
      if (this.disposed || token !== this.routeToken) return;
      this.detailInFlight = null;
      if (!failed) this.acceptDetail(sessionId, detail);
      else if (!this.detail) this.renderReadError(() => this.refreshDetail());
      if (this.detailAgain) {
        this.detailAgain = false;
        this.refreshDetail();
      }
    };
    this.options.port.getSession(sessionId).then(
      (detail) => settle(detail, false),
      () => settle(null, true),
    );
  }

  private acceptDetail(sessionId: string, detail: SubAgentInspectionDetail | null): void {
    const bodyEl = this.bodyEl;
    if (!bodyEl) return;
    if (!detail) {
      this.leaveDetail();
      bodyEl.empty();
      this.renderBackOnly(bodyEl);
      renderEmptyState(bodyEl, this.options.t("chat.subAgents.notFound"), this.options.t);
      this.setTimer(false);
      return;
    }
    this.detail = detail;
    this.detailAt = this.now();
    const runIds = detail.runs.map((run) => run.subAgentRunId);
    if (this.selectedRunId === null || !runIds.includes(this.selectedRunId)) {
      this.selectedRunId = detail.selectedRunId ?? runIds.at(-1) ?? null;
    }
    if (!this.detailView) {
      bodyEl.empty();
      this.detailView = new SessionDetailView(
        bodyEl,
        { app: this.options.app, markdownContext: this.component, t: this.options.t },
        {
          onBack: () => this.showList(),
          onSelectRun: (runId) => {
            this.selectedRunId = runId;
            this.renderDetail();
          },
          onStop: () => this.stop(sessionId),
        },
      );
    }
    this.renderDetail();
  }

  private renderBackOnly(bodyEl: HTMLElement): void {
    const back = bodyEl.createEl("button", {
      cls: "attest-sub-agents__back",
      text: this.options.t("chat.subAgents.back"),
      attr: { type: "button" },
    });
    back.addEventListener("click", () => this.showList());
  }

  private renderDetail(): void {
    const detail = this.detail;
    if (!detail || !this.detailView) return;
    const sessionId = detail.card.sessionId;
    this.detailView.update(detail, {
      selectedRunId: this.selectedRunId,
      debug: this.debug,
      stop: this.stopping.has(sessionId)
        ? { phase: "pending" }
        : (this.stops.get(sessionId) ?? { phase: "idle" }),
      elapsedOf: (card) => this.elapsedOf(card, this.detailAt),
    });
    this.setTimer(detail.card.status === "running");
  }

  private stop(sessionId: string): void {
    const card = this.detail?.card;
    if (!card || card.sessionId !== sessionId || this.stopping.has(sessionId)) return;
    const expectedRunId = card.controlRunId;
    this.stopping.add(sessionId);
    this.stops.delete(sessionId);
    this.renderDetail();
    const finish = (state: StopState | null): void => {
      this.stopping.delete(sessionId);
      if (this.disposed) {
        if (state === null) {
          this.options.onStopFailedOutside(this.options.t("chat.subAgents.stop.failedNotice"));
        }
        return;
      }
      this.stops.set(sessionId, state ?? { phase: "failed" });
      const visible = this.route.kind === "detail" && this.route.sessionId === sessionId;
      if (visible) {
        this.renderDetail();
        this.refreshDetail();
      }
    };
    this.options.port.stopFromUser(sessionId, expectedRunId).then(
      (result) => finish(result === "stale" ? { phase: "stale" } : { phase: "idle" }),
      () => finish(null),
    );
  }

  private elapsedOf(card: SubAgentSessionCard, receivedAt: number): number {
    return liveElapsed(card, receivedAt, this.now());
  }

  private setTimer(running: boolean): void {
    const wanted = running && !this.disposed;
    if (wanted && this.timer === null) {
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    } else if (!wanted && this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (this.route.kind === "detail") {
      this.detailView?.tick();
      return;
    }
    for (const { card, el } of this.list?.elapsed.values() ?? []) {
      if (card.status === "running") {
        el.setText(formatElapsed(this.elapsedOf(card, this.snapshotAt), this.options.t));
      }
    }
  }
}
