export type ResearchExportState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; path: string }
  | { kind: "failed"; reason: string };

export interface ResearchExportControllerOptions {
  exportReport(researchId: string, folder?: string): Promise<{ path: string }>;
  defaultFolder(): string;
  requestRedisplay(): void;
}

/**
 * Owns the export state and the typed folder draft of each finished research of a view, so a
 * redisplay keeps both. A start while that research's export is pending is ignored.
 */
export class ResearchExportController {
  private readonly states = new Map<string, ResearchExportState>();
  private readonly drafts = new Map<string, string>();

  constructor(private readonly options: ResearchExportControllerOptions) {}

  state(researchId: string): ResearchExportState {
    return this.states.get(researchId) ?? { kind: "idle" };
  }

  draft(researchId: string): string {
    return this.drafts.get(researchId) ?? "";
  }

  setDraft(researchId: string, folder: string): void {
    this.drafts.set(researchId, folder);
  }

  defaultFolder(): string {
    return this.options.defaultFolder();
  }

  start(researchId: string, folder?: string): void {
    if (this.state(researchId).kind === "pending") return;
    this.update(researchId, { kind: "pending" });
    const override = folder?.trim() ? folder : undefined;
    void this.options.exportReport(researchId, override).then(
      ({ path }) => this.update(researchId, { kind: "done", path }),
      (error: unknown) =>
        this.update(researchId, {
          kind: "failed",
          reason: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  private update(researchId: string, state: ResearchExportState): void {
    this.states.set(researchId, state);
    this.options.requestRedisplay();
  }
}
