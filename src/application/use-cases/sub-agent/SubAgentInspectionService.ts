import type {
  SubAgentInspectionDetail,
  SubAgentInspectionSnapshot,
} from "@application/contracts/subAgentInspection";
import type { SubAgentInspectionPort, SubAgentUserStopResult } from "@application/ports/subAgent";
import {
  buildInspectionDetail,
  buildInspectionSnapshot,
  type SubAgentInspectionInputs,
} from "./inspectionView";

export interface SubAgentInspectionSource {
  load(): Promise<unknown>;
  inputs(): SubAgentInspectionInputs;
  subscribe(listener: () => void): () => void;
  stop(sessionId: string, expectedRunId: string | null): Promise<SubAgentUserStopResult>;
}

/**
 * The inspection capability of one chat runtime. It reads the manager only through the
 * callbacks it was built with and returns copied DTOs; change notifications are
 * coalesced into one snapshot per microtask, and unsubscribing never stops the manager.
 */
export class SubAgentInspectionService implements SubAgentInspectionPort {
  private readonly listeners = new Set<(snapshot: SubAgentInspectionSnapshot) => void>();
  private detach: (() => void) | null = null;
  private scheduled = false;

  constructor(private readonly source: SubAgentInspectionSource) {}

  async snapshot(): Promise<SubAgentInspectionSnapshot> {
    await this.source.load();
    return buildInspectionSnapshot(this.source.inputs());
  }

  async getSession(sessionId: string): Promise<SubAgentInspectionDetail | null> {
    await this.source.load();
    return buildInspectionDetail(this.source.inputs(), sessionId);
  }

  subscribe(listener: (snapshot: SubAgentInspectionSnapshot) => void): () => void {
    this.listeners.add(listener);
    this.detach ??= this.source.subscribe(() => this.schedule());
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0 || !this.detach) return;
      this.detach();
      this.detach = null;
    };
  }

  stopFromUser(sessionId: string, expectedRunId: string | null): Promise<SubAgentUserStopResult> {
    return this.source.stop(sessionId, expectedRunId);
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    void Promise.resolve().then(() => {
      this.scheduled = false;
      if (this.listeners.size === 0) return;
      const snapshot = buildInspectionSnapshot(this.source.inputs());
      for (const listener of [...this.listeners]) {
        if (!this.listeners.has(listener)) continue;
        try {
          listener(snapshot);
        } catch {
          continue;
        }
      }
    });
  }
}
