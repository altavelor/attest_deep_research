import { isAttestError } from "@core/errors";

export type WebSourceIssueReason = "unauthorized" | "rate-limited";

export interface WebSourceIssue {
  reason: WebSourceIssueReason;

  until: number;
}

export interface WebSourceHealthTrackerOptions {
  rateLimitCooldownMs?: number;
  now?: () => number;
}

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 10 * 60_000;

export class WebSourceHealthTracker {
  private readonly issues = new Map<string, WebSourceIssue>();

  constructor(private readonly options: WebSourceHealthTrackerOptions = {}) {}

  /** Bad key or exhausted quota ⇒ stop hitting the source instead of failing every search. */
  reportFailure(sourceId: string, error: unknown): void {
    if (!isAttestError(error)) {
      return;
    }
    const reason = error.details?.reason;
    if (reason === "unauthorized") {
      this.issues.set(sourceId, { reason, until: Number.POSITIVE_INFINITY });
    } else if (reason === "rate-limited") {
      this.issues.set(sourceId, {
        reason,
        until: this.now() + (this.options.rateLimitCooldownMs ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS),
      });
    }
  }

  reportSuccess(sourceId: string): void {
    this.issues.delete(sourceId);
  }

  /** Clears a recorded issue (e.g. after the user edits the source's credentials). */
  reset(sourceId: string): void {
    this.issues.delete(sourceId);
  }

  /** Active issue, if any; expired cooldowns are cleaned up lazily. */
  getIssue(sourceId: string): WebSourceIssue | undefined {
    const issue = this.issues.get(sourceId);
    if (!issue) {
      return undefined;
    }
    if (issue.until <= this.now()) {
      this.issues.delete(sourceId);
      return undefined;
    }
    return issue;
  }

  isAvailable(sourceId: string): boolean {
    return this.getIssue(sourceId) === undefined;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
