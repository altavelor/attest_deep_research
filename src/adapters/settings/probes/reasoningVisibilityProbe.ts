import { ChatModelProvider } from "@core/agent";

export interface ReasoningVisibilityProbeOptions {
  provider: ChatModelProvider;
  model: string;
  signal?: AbortSignal;
}

export interface ReasoningVisibilityProbeResult {
  visible: boolean;
  requestCount: 1;
  checkedAt: string;
  expiresAt: string;
  failureReason?: string;
}

export async function probeReasoningVisibility(
  options: ReasoningVisibilityProbeOptions,
): Promise<ReasoningVisibilityProbeResult> {
  const checkedAt = new Date();
  let visible = false;
  let failureReason: string | undefined;
  try {
    for await (const chunk of options.provider.streamChat({
      model: options.model,
      messages: [
        {
          role: "user",
          content: "Briefly reason about 2 + 2, then return only the final number.",
        },
      ],
      maxTokens: 128,
      temperature: 0,
      signal: options.signal,
    })) {
      if (chunk.events?.some((event) => event.type === "reasoning-delta")) visible = true;
      if (chunk.isComplete) break;
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    failureReason = "reasoning-visibility-probe-failed";
  }
  if (options.signal?.aborted) {
    throw new DOMException("Reasoning visibility probe cancelled.", "AbortError");
  }
  const ttlMs = visible ? 7 * 24 * 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  return {
    visible,
    requestCount: 1,
    checkedAt: checkedAt.toISOString(),
    expiresAt: new Date(checkedAt.getTime() + ttlMs).toISOString(),
    ...(failureReason ? { failureReason } : {}),
  };
}
