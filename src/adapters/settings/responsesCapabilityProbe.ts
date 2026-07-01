import { OpenAiResponsesClient } from "@adapters/model-provider/chat/responses/OpenAiResponsesClient";
import { ReasoningCapabilitySettings, ServerProfile } from "./types";
import type { PluginRequestLogger } from "./debugLogger";
import { isIxplorerError } from "@core/errors";

const PROBE_TOOL = "ixplorer_responses_probe";
const PROBE_MAX_OUTPUT_TOKENS = 512;
const FALLBACK_REASONING_EFFORTS = ["medium", "low", "high", "minimal"] as const;
export const RESPONSES_PROBE_CONTRACT_VERSION = 1;

export interface ResponsesCapabilityProbeOptions {
  server: ServerProfile;
  model: string;
  efforts?: string[];
  fetch?: typeof fetch;
  logger?: PluginRequestLogger;
  signal?: AbortSignal;
}

export async function probeResponsesCapabilities(
  options: ResponsesCapabilityProbeOptions,
): Promise<ReasoningCapabilitySettings> {
  const checkedAt = new Date().toISOString();
  const efforts = [
    ...new Set((options.efforts ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  const cacheKey = responsesProbeCacheKey(options.server, options.model, efforts);
  if (options.server.apiFormat !== "openai-compatible") {
    return failed(checkedAt, cacheKey);
  }
  const base = { checkedAt, contractVersion: RESPONSES_PROBE_CONTRACT_VERSION };
  let lastFailureReason: string | undefined;
  let defaultEffort: string | undefined;
  for (const effort of [...new Set([...FALLBACK_REASONING_EFFORTS, ...efforts])]) {
    const attempt = await runProbe(options, effort, false);
    lastFailureReason = attempt.failureReason ?? lastFailureReason;
    if (options.signal?.aborted)
      throw new DOMException("Responses capability probe cancelled.", "AbortError");
    if (attempt.ok) {
      defaultEffort = effort;
      break;
    }
  }
  if (!defaultEffort) return failed(checkedAt, cacheKey, lastFailureReason);
  const verifiedEfforts: string[] = [defaultEffort];
  for (const effort of efforts) {
    if (verifiedEfforts.includes(effort)) continue;
    if ((await runProbe(options, effort, false)).ok) verifiedEfforts.push(effort);
    if (options.signal?.aborted)
      throw new DOMException("Responses capability probe cancelled.", "AbortError");
  }
  const summary = (await runProbe(options, defaultEffort, true)).ok;
  if (options.signal?.aborted)
    throw new DOMException("Responses capability probe cancelled.", "AbortError");
  return {
    source: "probe",
    responses: true,
    continuation: true,
    summary,
    efforts: verifiedEfforts,
    defaultEffort,
    cacheKey: responsesProbeCacheKey(options.server, options.model, verifiedEfforts),
    ...base,
  };
}

async function runProbe(
  options: ResponsesCapabilityProbeOptions,
  effort: string | undefined,
  summary: boolean,
): Promise<{ ok: boolean; failureReason?: string }> {
  try {
    const client = new OpenAiResponsesClient({
      baseUrl: options.server.baseUrl,
      apiKey: options.server.apiKey,
      fetch: options.fetch,
      reasoningEfforts: effort ? [effort] : [],
      reasoningSummary: summary,
    });
    const first = await client.runRound({
      model: options.model,
      messages: [{ role: "user", content: "Run the requested synthetic protocol check." }],
      tools: [
        {
          type: "function",
          function: {
            name: PROBE_TOOL,
            description: "Return the constant synthetic probe result.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
      ],
      toolChoice: { type: "specific", name: PROBE_TOOL },
      reasoning: {
        enabled: true,
        ...(effort ? { effort } : {}),
        summary: summary ? "auto" : "off",
      },
      maxTokens: PROBE_MAX_OUTPUT_TOKENS,
      signal: options.signal,
    });
    const call = first.items.find((item) => item.type === "toolCall");
    if (!call || call.call.name !== PROBE_TOOL) {
      return {
        ok: false,
        failureReason: "Responses probe did not receive the required tool call.",
      };
    }
    if (!first.continuation) {
      return { ok: false, failureReason: "Responses probe did not create continuation state." };
    }
    const second = await client.runRound({
      model: options.model,
      messages: [{ role: "user", content: "Run the requested synthetic protocol check." }],
      tools: [
        {
          type: "function",
          function: {
            name: PROBE_TOOL,
            description: "Synthetic check.",
            parameters: { type: "object", properties: {}, additionalProperties: false },
          },
        },
      ],
      continuation: first.continuation,
      toolOutputs: [{ callId: call.call.id, output: "synthetic-ok" }],
      reasoning: {
        enabled: true,
        ...(effort ? { effort } : {}),
        summary: summary ? "auto" : "off",
      },
      maxTokens: PROBE_MAX_OUTPUT_TOKENS,
      signal: options.signal,
    });
    second.continuation?.dispose();
    const summaryObserved = [...first.items, ...second.items].some(
      (item) => item.type === "reasoningSummary",
    );
    if (second.stopReason !== "complete") {
      return {
        ok: false,
        failureReason: `Responses probe continuation stopped with ${second.stopReason}.`,
      };
    }
    if (summary && !summaryObserved) {
      return { ok: false, failureReason: "Responses probe did not observe a reasoning summary." };
    }
    return { ok: true };
  } catch (error) {
    const providerMessage = isIxplorerError(error) ? error.details?.providerMessage : undefined;
    const protocolReason = isIxplorerError(error) ? error.details?.reason : undefined;
    return {
      ok: false,
      ...(typeof providerMessage === "string"
        ? { failureReason: providerMessage }
        : typeof protocolReason === "string"
          ? { failureReason: `Responses protocol error: ${protocolReason}.` }
          : {}),
    };
  }
}

export function responsesProbeCacheKey(
  server: Pick<ServerProfile, "baseUrl" | "apiKey">,
  model: string,
  efforts: string[],
): string {
  const identity = JSON.stringify({
    baseUrl: server.baseUrl.trim().replace(/\/+$/, ""),
    auth: server.apiKey ?? "",
    model: model.trim(),
    protocol: "responses",
    efforts,
    version: RESPONSES_PROBE_CONTRACT_VERSION,
  });
  return stableIdentityHash(identity);
}

export function isResponsesCapabilityCurrent(
  capabilities: ReasoningCapabilitySettings | undefined,
  server: Pick<ServerProfile, "baseUrl" | "apiKey">,
  model: string,
  now = Date.now(),
): boolean {
  if (capabilities?.responses !== true) return false;
  if (capabilities.source !== "probe") return true;
  const checkedAt = capabilities.checkedAt ? Date.parse(capabilities.checkedAt) : Number.NaN;
  return (
    Number.isFinite(checkedAt) &&
    now - checkedAt <= 7 * 24 * 60 * 60 * 1000 &&
    capabilities.contractVersion === RESPONSES_PROBE_CONTRACT_VERSION &&
    capabilities.cacheKey === responsesProbeCacheKey(server, model, capabilities.efforts)
  );
}

function stableIdentityHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function failed(
  checkedAt: string,
  cacheKey: string,
  failureReason?: string,
): ReasoningCapabilitySettings {
  const reason =
    failureReason ??
    "Responses capability probe did not complete the required tool-call continuation.";
  return {
    source: "probe",
    responses: false,
    continuation: false,
    summary: false,
    efforts: [],
    checkedAt,
    cacheKey,
    contractVersion: RESPONSES_PROBE_CONTRACT_VERSION,
    failureReason: reason.slice(0, 500),
  };
}
