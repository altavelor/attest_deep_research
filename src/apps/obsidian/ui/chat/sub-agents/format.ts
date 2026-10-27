import type { Translate } from "@adapters/i18n";
import type { SubAgentSessionCard } from "@application/contracts/subAgentInspection";
import type {
  NormalizedUsage,
  SubAgentModelSnapshot,
  SubAgentRunSummary,
  SubAgentSessionStatus,
} from "@core/research";

export type TokenTone = "normal" | "partial" | "none";

export interface TokenText {
  text: string;
  tone: TokenTone;
}

const STATUS_TONES: Record<SubAgentSessionStatus, string> = {
  running: "running",
  queued: "queued",
  importing: "importing",
  ready: "ready",
  stopping: "stopping",
  interrupted: "stopping",
  failed: "failed",
  archived: "queued",
};

/** Formats a duration as minutes and seconds, or hours and minutes past one hour. */
export function formatElapsed(ms: number, t: Translate): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return t("chat.subAgents.elapsed.long", { hours, minutes: pad(minutes) });
  }
  return t("chat.subAgents.elapsed.short", { minutes, seconds: pad(seconds) });
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Returns the token total the usage really reports, or null when no token field is known. */
export function knownTokenTotal(usage: NormalizedUsage): number | null {
  if (usage.source === "unavailable") return null;
  if (usage.totalTokens !== undefined) return usage.totalTokens;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) return null;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

/** Formats a session's token usage with its partial or missing-data marker; it never invents zero. */
export function formatTokens(card: SubAgentSessionCard, t: Translate): TokenText {
  const total = knownTokenTotal(card.usage);
  if (total === null) return { text: t("chat.subAgents.tokens.none"), tone: "none" };
  const count = compactCount(total);
  return card.usageIncomplete
    ? { text: t("chat.subAgents.tokens.partial", { count }), tone: "partial" }
    : { text: t("chat.subAgents.tokens", { count }), tone: "normal" };
}

function compactCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function statusLabel(status: SubAgentSessionStatus, t: Translate): string {
  return t(`chat.subAgents.status.${status}`);
}

export function statusTone(status: SubAgentSessionStatus): string {
  return STATUS_TONES[status];
}

export function modelLabel(model: SubAgentModelSnapshot | null | undefined, t: Translate): string {
  return model?.label || model?.modelId || t("chat.subAgents.noModel");
}

/** Tells whether the runs of a session used more than one model. */
export function modelsChanged(runs: readonly SubAgentRunSummary[]): boolean {
  const labels = new Set(
    runs.flatMap((run) => (run.model ? [`${run.model.providerId}/${run.model.modelId}`] : [])),
  );
  return labels.size > 1;
}

/** Live elapsed time of a card: a running card advances from the moment its snapshot arrived. */
export function liveElapsed(card: SubAgentSessionCard, receivedAt: number, now: number): number {
  return card.status === "running"
    ? card.elapsedMs + Math.max(0, now - receivedAt)
    : card.elapsedMs;
}
