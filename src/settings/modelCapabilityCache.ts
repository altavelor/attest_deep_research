import { ChatApiProtocol } from "../shared/types";

export type CapabilityState = "supported" | "unsupported" | "unknown";
export type ReasoningResponseFormat =
  | "reasoning_details"
  | "reasoning"
  | "reasoning_content"
  | "thinking"
  | "inline_tags"
  | "responses_text"
  | "responses_summary";

export interface ModelCapabilitySnapshot {
  protocols: {
    chatCompletions: CapabilityState;
    responses: CapabilityState;
  };
  reasoning: {
    responseFormats: ReasoningResponseFormat[];
    requestDialect?: "responses" | "openrouter" | "provider-extension";
    efforts?: string[];
    defaultEffort?: string;
    visibleOutput: CapabilityState;
  };
  tools: CapabilityState;
  continuation: CapabilityState;
  summary: CapabilityState;
  source: "metadata" | "observed" | "manual" | "probe";
  checkedAt: string;
  expiresAt?: string;
  contractVersion: 1;
}

export interface CapabilityIdentity {
  baseUrl: string;
  apiKey?: string;
  model: string;
  protocol: ChatApiProtocol;
}

export function capabilityCacheKey(identity: CapabilityIdentity): string {
  const endpoint = identity.baseUrl.trim().replace(/\/+$/, "");
  const authFingerprint = stableIdentityHash(identity.apiKey ?? "anonymous");
  return `${endpoint}|${identity.model.trim()}|${identity.protocol}|v1|auth:${authFingerprint}`;
}

export function recordObservedReasoningFormat(
  cache: Record<string, ModelCapabilitySnapshot>,
  identity: CapabilityIdentity,
  dialect: string,
  checkedAt = new Date().toISOString(),
): Record<string, ModelCapabilitySnapshot> {
  const format = normalizeFormat(dialect);
  if (!format) return cache;
  const key = capabilityCacheKey(identity);
  const current = cache[key] ?? unknownSnapshot(checkedAt);
  const snapshot: ModelCapabilitySnapshot = {
    ...current,
    protocols: {
      ...current.protocols,
      [identity.protocol === "responses" ? "responses" : "chatCompletions"]: "supported",
    },
    reasoning: {
      ...current.reasoning,
      responseFormats: [...new Set([...current.reasoning.responseFormats, format])],
      visibleOutput: "supported",
    },
    source: "observed",
    checkedAt,
  };
  return { ...cache, [key]: snapshot };
}

export function unknownSnapshot(checkedAt: string): ModelCapabilitySnapshot {
  return {
    protocols: { chatCompletions: "unknown", responses: "unknown" },
    reasoning: { responseFormats: [], visibleOutput: "unknown" },
    tools: "unknown",
    continuation: "unknown",
    summary: "unknown",
    source: "metadata",
    checkedAt,
    contractVersion: 1,
  };
}

export interface CapabilityRefreshToken {
  profileId: string;
  identity: string;
  generation: number;
}

export class CapabilityRefreshCoordinator {
  private readonly generations = new Map<string, { identity: string; generation: number }>();

  begin(profileId: string, identity: string): CapabilityRefreshToken {
    const generation = (this.generations.get(profileId)?.generation ?? 0) + 1;
    this.generations.set(profileId, { identity, generation });
    return { profileId, identity, generation };
  }

  isCurrent(token: CapabilityRefreshToken): boolean {
    const current = this.generations.get(token.profileId);
    return current?.identity === token.identity && current.generation === token.generation;
  }
}

export function readModelCapabilityCache(value: unknown): Record<string, ModelCapabilitySnapshot> {
  if (!isRecord(value)) return {};
  const cache: Record<string, ModelCapabilitySnapshot> = {};
  for (const [key, candidate] of Object.entries(value)) {
    const snapshot = readSnapshot(candidate);
    if (snapshot) cache[key] = snapshot;
  }
  return cache;
}

function readSnapshot(value: unknown): ModelCapabilitySnapshot | undefined {
  if (!isRecord(value) || !isRecord(value.protocols) || !isRecord(value.reasoning)) {
    return undefined;
  }
  const source = value.source;
  if (source !== "metadata" && source !== "observed" && source !== "manual" && source !== "probe") {
    return undefined;
  }
  const state = (candidate: unknown): CapabilityState =>
    candidate === "supported" || candidate === "unsupported" ? candidate : "unknown";
  const formats = Array.isArray(value.reasoning.responseFormats)
    ? value.reasoning.responseFormats.flatMap((item) =>
        typeof item === "string" && normalizeFormat(item) ? [normalizeFormat(item)!] : [],
      )
    : [];
  return {
    protocols: {
      chatCompletions: state(value.protocols.chatCompletions),
      responses: state(value.protocols.responses),
    },
    reasoning: {
      responseFormats: [...new Set(formats)],
      visibleOutput: state(value.reasoning.visibleOutput),
    },
    tools: state(value.tools),
    continuation: state(value.continuation),
    summary: state(value.summary),
    source,
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : new Date(0).toISOString(),
    ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
    contractVersion: 1,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeFormat(value: string): ReasoningResponseFormat | undefined {
  const normalized = value === "inline-tags" ? "inline_tags" : value;
  return [
    "reasoning_details",
    "reasoning",
    "reasoning_content",
    "thinking",
    "inline_tags",
    "responses_text",
    "responses_summary",
  ].includes(normalized)
    ? (normalized as ReasoningResponseFormat)
    : undefined;
}

function stableIdentityHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
