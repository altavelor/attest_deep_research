import type { SubAgentMainEventIntent } from "@application/ports/subAgent";
import {
  capRedactedText,
  findOwnRun,
  MAX_REPLY_EXCERPT_BYTES,
  safeSubAgentCode,
  subAgentDispatchKey,
  subAgentNoticeKey,
  type SubAgentCommand,
  type SubAgentNoticeEntry,
  type SubAgentNoticeKind,
} from "@core/research";
import { sessionDescription } from "./inspectionView";
import { timestamp, type SubAgentManagerParts } from "./managerParts";

export type SubAgentTerminalNoticeKind = Extract<
  SubAgentNoticeKind,
  "not-started" | "finished" | "partial" | "failed" | "stopped" | "interrupted" | "import-failed"
>;

/**
 * Builds the main-visible dispatch and notice intents of lifecycle transitions. Intents
 * are built synchronously from the transition's state and delivered to the chat sink
 * off-lock; each event key is published at most once and a closed parent run or worker
 * command never creates a new entry. A created session and a command waiting for a slot
 * are separate events, so one session may get both a created and a queued notice.
 */
export class SubAgentMainEvents {
  private readonly published = new Set<string>();

  constructor(private readonly parts: SubAgentManagerParts) {}

  dispatch(sessionId: string, runId: string, commandKind: SubAgentCommand["type"] | "retry"): void {
    const record = this.parts.store.record(sessionId);
    const run = record ? findOwnRun(record, runId) : undefined;
    const chatId = this.parts.store.state?.chatId;
    if (!record || !run || !chatId || run.origin !== "direct" || !this.live(run.parentRunId)) {
      return;
    }
    this.publish({
      type: "dispatch",
      entry: {
        eventKey: subAgentDispatchKey(chatId, run.parentRunId, sessionId, runId),
        sessionId,
        runId,
        parentRunId: run.parentRunId,
        body: this.parts.observation.redact(run.command),
        createdAt: timestamp(this.parts),
        commandKind,
        attempt: run.attempt,
      },
    });
  }

  created(sessionId: string, kind: "created" | "queued", runId: string | null = null): void {
    const record = this.parts.store.record(sessionId);
    const run = record && runId ? findOwnRun(record, runId) : undefined;
    if (!record || (runId && run?.origin !== "direct")) return;
    this.notice(sessionId, runId, kind, {});
  }

  terminal(
    sessionId: string,
    runId: string,
    kind: SubAgentTerminalNoticeKind,
    answerText?: string,
  ): void {
    const record = this.parts.store.record(sessionId);
    const run = record ? findOwnRun(record, runId) : undefined;
    if (!run || run.origin !== "direct") return;
    const reply =
      answerText === undefined
        ? undefined
        : capRedactedText(
            this.parts.observation.redact(answerText),
            MAX_REPLY_EXCERPT_BYTES,
            "utf8",
          );
    this.notice(sessionId, runId, kind, {
      durationMs: run.usage.durationMs,
      usage: run.usage,
      ...(run.model ? { modelLabel: run.model.label } : {}),
      ...(run.terminalReason !== null ? { reasonCode: safeSubAgentCode(run.terminalReason) } : {}),
      ...(reply ? { replyExcerpt: reply.text, replyTruncated: reply.truncated } : {}),
    });
  }

  closed(parentRunId: string, closedCount: number): void {
    const chatId = this.parts.store.state?.chatId;
    if (!chatId || closedCount <= 0) return;
    this.publish({
      type: "notice",
      entry: {
        eventKey: subAgentNoticeKey(chatId, parentRunId, null, null, "closed"),
        parentRunId,
        description: "",
        createdAt: timestamp(this.parts),
        sessionId: null,
        runId: null,
        kind: "closed",
        closedCount,
      },
    });
  }

  private notice(
    sessionId: string,
    runId: string | null,
    kind: SubAgentNoticeKind,
    details: Partial<SubAgentNoticeEntry>,
  ): boolean {
    const record = this.parts.store.record(sessionId);
    const chatId = this.parts.store.state?.chatId;
    if (!record || !chatId || !this.live(record.session.parentRunId)) return false;
    const { parentRunId } = record.session;
    return this.publish({
      type: "notice",
      entry: {
        ...details,
        eventKey: subAgentNoticeKey(chatId, parentRunId, sessionId, runId, kind),
        parentRunId,
        description: sessionDescription(record, (text) => this.parts.observation.redact(text)),
        createdAt: timestamp(this.parts),
        sessionId,
        runId,
        kind,
      },
    });
  }

  clear(): void {
    this.published.clear();
  }

  private live(parentRunId: string): boolean {
    return !this.parts.fences.disposed && !this.parts.fences.isRevoked(parentRunId);
  }

  private publish(intent: SubAgentMainEventIntent): boolean {
    const sink = this.parts.context.mainEvents;
    if (!sink || this.published.has(intent.entry.eventKey)) return false;
    this.published.add(intent.entry.eventKey);
    void Promise.resolve()
      .then(() => sink.publish([intent]))
      .catch(() => undefined);
    return true;
  }
}
