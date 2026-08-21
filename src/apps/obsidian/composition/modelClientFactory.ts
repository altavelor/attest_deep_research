import {
  ChatCompletionsRoundAdapter,
  ChatModelClient,
  FallbackModelRoundProvider,
  OpenAiResponsesClient,
  resolveResponsesProviderPolicy,
} from "@adapters/model-provider";
import {
  capabilityCacheKey,
  ChatModelProfile,
  isResponsesCapabilityCurrent,
  recordObservedReasoningFormat,
  ReasoningResponseFormat,
  ServerProfile,
} from "@adapters/settings";
import { QueryExpansionService } from "@adapters/retrieval";
import type { ModelRoundProvider } from "@core/agent";

import { CompositionContext } from "./CompositionContext";
import { resolveProviderFetch } from "@apps/obsidian/modelProviderRuntime";

export function createChatModelClient(
  ctx: CompositionContext,
  server: ServerProfile,
  profile?: ChatModelProfile,
): ChatModelClient {
  return new ChatModelClient({
    apiFormat: server.apiFormat,
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    logger: ctx.logger,
    fetch: resolveProviderFetch(server, "streaming", ctx.isMobile === true),
    ...(profile
      ? {
          onReasoningObserved: (observation: { protocol: "chat-completions"; dialect: string }) => {
            const identity = {
              baseUrl: server.baseUrl,
              apiKey: server.apiKey,
              model: profile.modelName,
              protocol: observation.protocol,
            };
            const key = capabilityCacheKey(identity);
            const settings = ctx.getSettings();
            const current = settings.modelCapabilityCache[key];
            const observedFormat = (
              observation.dialect === "inline-tags" ? "inline_tags" : observation.dialect
            ) as ReasoningResponseFormat;
            if (current?.reasoning.responseFormats.includes(observedFormat)) return;
            settings.modelCapabilityCache = recordObservedReasoningFormat(
              settings.modelCapabilityCache,
              identity,
              observation.dialect,
            );
            void ctx.saveSettings();
          },
        }
      : {}),
  });
}

export function createResponsesRoundProvider(
  ctx: CompositionContext,
  profile: ChatModelProfile,
  server: ServerProfile,
  effectiveProtocol: "chat-completions" | "responses",
  reasoning: { enabled: boolean; effort?: string; summary: "off" | "auto" },
): ModelRoundProvider | undefined {
  if (effectiveProtocol !== "responses") return undefined;
  const decision = resolveResponsesProviderPolicy({
    apiFormat: server.apiFormat,
    capabilities: profile.reasoningCapabilities,
    isCapabilityCurrent: profile.reasoningCapabilities
      ? isResponsesCapabilityCurrent(profile.reasoningCapabilities, server, profile.modelName)
      : false,
    reasoning,
  });
  return new FallbackModelRoundProvider(
    new OpenAiResponsesClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      logger: ctx.logger,
      fetch: resolveProviderFetch(server, "streaming", ctx.isMobile === true),
      reasoningEfforts: decision.efforts,
      reasoningSummary: decision.summary,
    }),
    new ChatCompletionsRoundAdapter(createChatModelClient(ctx, server)),
  );
}

export function createQueryExpansionService(
  ctx: CompositionContext,
  chatProfile: ChatModelProfile,
  server: ServerProfile,
): QueryExpansionService {
  return new QueryExpansionService({
    chatModel: createChatModelClient(ctx, server),
    chatModelName: chatProfile.modelName,
    chatOptions: { temperature: chatProfile.temperature, maxTokens: chatProfile.maxTokens },
  });
}
