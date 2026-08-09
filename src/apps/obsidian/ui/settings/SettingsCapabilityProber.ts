import { Notice } from "obsidian";

import type IxplorerPlugin from "@apps/obsidian/main";
import { ChatModelClient } from "@adapters/model-provider";
import { isResponsesCapabilityCurrent, probeResponsesCapabilities } from "@adapters/settings";
import { startChatProfileProbes as startChatProfileProbeTasks } from "@adapters/settings";
import {
  fetchAvailableModels,
  fetchModelContextLength,
  verifyEmbeddingCapability,
  DiscoveredModel,
} from "@adapters/settings";
import { probeToolControlCapabilities, ToolCapabilityProbeResult } from "@adapters/settings";
import { createToolCapabilitySettings } from "@adapters/settings";
import { capabilityCacheKey, ModelCapabilitySnapshot, unknownSnapshot } from "@adapters/settings";
import { probeReasoningVisibility } from "@adapters/settings";
import { ChatModelProfile, ServerProfile } from "@adapters/settings";
import {
  applyCapabilityVerificationState,
  capabilityVerificationIdentity,
  CapabilityVerificationState,
  deriveCapabilityVerificationState,
  resolvedAgenticModeAfterProbe,
  reasoningEffortCandidates,
} from "@adapters/settings";

export interface CapabilityProberHost {
  readonly plugin: IxplorerPlugin;

  readonly fetchedModelsByServerId: Map<string, DiscoveredModel[]>;

  requestRedisplay(): void;
}

/**
 * Background capability discovery for settings: fetches models, verifies
 * embedding support, and probes tool-calling and reasoning capabilities. This is
 * orchestration over adapters rather than UI rendering, so it lives apart from
 * the settings tab and only calls back to redisplay when state changes.
 */
export class SettingsCapabilityProber {
  private readonly plugin: IxplorerPlugin;
  private readonly fetchedModelsByServerId: Map<string, DiscoveredModel[]>;
  private readonly requestRedisplay: () => void;
  private readonly states = new Map<
    string,
    { identity: string; state: CapabilityVerificationState }
  >();
  private readonly subscribers = new Set<() => void>();

  constructor(host: CapabilityProberHost) {
    this.plugin = host.plugin;
    this.fetchedModelsByServerId = host.fetchedModelsByServerId;
    this.requestRedisplay = () => host.requestRedisplay();
  }

  subscribeAll(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  statusFor(profile: ChatModelProfile): CapabilityVerificationState {
    const cached = this.states.get(profile.id);
    return cached?.identity === capabilityVerificationIdentity(profile)
      ? cached.state
      : deriveCapabilityVerificationState(profile);
  }

  private publishState(profileId: string, state: Partial<CapabilityVerificationState>): void {
    const profile = this.plugin.settings.chatModelProfiles.find(
      (candidate) => candidate.id === profileId,
    );
    this.states.set(profileId, {
      identity: profile ? capabilityVerificationIdentity(profile) : "",
      state: applyCapabilityVerificationState(
        profile ? this.statusFor(profile) : { tools: "not-tested", agent: "not-tested" },
        state,
      ),
    });
    this.subscribers.forEach((listener) => listener());
  }

  async refreshMetadataCapabilities(): Promise<void> {
    let changed = false;
    for (const server of this.plugin.settings.serverProfiles.filter(
      (candidate) => candidate.isSuspended !== true,
    )) {
      const identity = `${server.baseUrl}|${server.updatedAt}`;
      const result = await fetchAvailableModels(server, { logger: this.plugin.logger });
      const currentServer = this.plugin.settings.serverProfiles.find(
        (candidate) => candidate.id === server.id,
      );
      if (!currentServer || `${currentServer.baseUrl}|${currentServer.updatedAt}` !== identity) {
        continue;
      }
      this.fetchedModelsByServerId.set(server.id, result.models);
      for (const model of result.models) {
        if (!model.capabilitySnapshot) continue;
        for (const protocol of ["chat-completions", "responses"] as const) {
          const key = capabilityCacheKey({
            baseUrl: server.baseUrl,
            apiKey: server.apiKey,
            model: model.id,
            protocol,
          });
          this.plugin.settings.modelCapabilityCache[key] = model.capabilitySnapshot;
          changed = true;
        }
      }
    }
    if (changed) await this.plugin.saveSettings();
  }

  async fetchModelsForServer(server: ServerProfile): Promise<DiscoveredModel[]> {
    const result = await fetchAvailableModels(server, { logger: this.plugin.logger });
    this.fetchedModelsByServerId.set(server.id, result.models);
    new Notice(result.message);
    return result.models;
  }

  async fetchContextLengthForModel(
    server: ServerProfile,
    modelName: string,
  ): Promise<number | undefined> {
    return fetchModelContextLength(server, modelName, { logger: this.plugin.logger });
  }

  startEmbeddingProfileProbe(profileId: string): void {
    const savedProfile = this.plugin.settings.embeddingModelProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (!savedProfile) return;
    const server = this.plugin.settings.serverProfiles.find(
      (profile) => profile.id === savedProfile.serverProfileId && profile.isSuspended !== true,
    );
    if (!server) return;
    const target = {
      profileId,
      serverProfileId: savedProfile.serverProfileId,
      modelName: savedProfile.modelName,
    };
    void this.verifyEmbeddingForServer(server, target.modelName)
      .then(async (verified) => {
        const profile = this.plugin.settings.embeddingModelProfiles.find(
          (candidate) =>
            candidate.id === target.profileId &&
            candidate.serverProfileId === target.serverProfileId &&
            candidate.modelName === target.modelName,
        );
        if (!profile) return;
        profile.capabilities ??= {
          chat: false,
          embeddings: verified,
          detectionSource: "probe",
        };
        profile.capabilities.embeddings = verified;
        profile.capabilities.detectionSource = "probe";
        if (verified) {
          if (profile.suspendedReason === "Embedding capability could not be verified.") {
            profile.isSuspended = false;
            profile.suspendedReason = undefined;
          }
        } else {
          profile.isSuspended = true;
          profile.suspendedReason = "Embedding capability could not be verified.";
        }
        profile.updatedAt = new Date().toISOString();
        await this.plugin.saveSettings();
        this.requestRedisplay();
      })
      .catch(
        () =>
          new Notice(
            this.plugin.translate("settings.prober.capabilityDetectionFailed", {
              profile: savedProfile.name,
            }),
          ),
      );
  }

  startChatProfileProbes(profileId: string, force = false): void {
    const savedProfile = this.plugin.settings.chatModelProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (!savedProfile) return;
    const server = this.plugin.settings.serverProfiles.find(
      (profile) => profile.id === savedProfile.serverProfileId && profile.isSuspended !== true,
    );
    if (!server) return;
    const target = {
      profileId,
      serverProfileId: savedProfile.serverProfileId,
      modelName: savedProfile.modelName,
    };
    const shouldProbeResponses =
      server.apiFormat === "openai-compatible" &&
      (force || savedProfile.reasoning.mode !== "off") &&
      (force ||
        !isResponsesCapabilityCurrent(
          savedProfile.reasoningCapabilities,
          server,
          savedProfile.modelName,
        ));
    this.publishState(profileId, {
      tools: "testing",
      ...(shouldProbeResponses ? { agent: "testing" } : {}),
    });

    startChatProfileProbeTasks({
      probeTools: () => this.probeToolsForServer(server, target.modelName),
      probeReasoning: () =>
        probeReasoningVisibility({
          provider: new ChatModelClient({
            apiFormat: server.apiFormat,
            baseUrl: server.baseUrl,
            apiKey: server.apiKey,
            logger: this.plugin.logger,
          }),
          model: target.modelName,
        }),
      probeResponses: shouldProbeResponses
        ? () =>
            probeResponsesCapabilities({
              server,
              model: target.modelName,
              efforts:
                this.reasoningEffortsFromCache(server, savedProfile.modelName) ??
                savedProfile.reasoningCapabilities?.efforts ??
                [],
              logger: this.plugin.logger,
            })
        : undefined,
      onTools: async (probe) => {
        let saved: unknown;
        await this.updateChatProfileAfterProbe(target, (profile) => {
          profile.capabilities ??= {
            chat: true,
            embeddings: false,
            detectionSource: "probe",
          };
          const { probeAuditData, ...capabilityLayer } = probe;
          const probeAudit = {
            ranAt: probeAuditData.ranAt,
            modelName: target.modelName,
            apiFormat: server.apiFormat,
            results: probeAuditData.results,
            rawCapabilities: {
              calls: capabilityLayer.calls,
              choiceRequired: capabilityLayer.choiceRequired,
              choiceSpecific: capabilityLayer.choiceSpecific,
              parallelCalls: capabilityLayer.parallelCalls,
            },
          };
          profile.capabilities.toolCalling = {
            formatDefault: {
              ...(profile.capabilities.toolCalling?.formatDefault ??
                createToolCapabilitySettings(false).formatDefault),
            },
            probe: capabilityLayer,
            probeAudit,
          };
          profile.capabilities.tools = probe.calls;
          saved = {
            tools: profile.capabilities.tools,
            toolCalling: profile.capabilities.toolCalling,
          };
          this.publishState(target.profileId, { tools: probe.calls ? "verified" : "not-verified" });
        });
        this.plugin.logger.logProbeResult({
          probe: "tool-capabilities",
          profileId: target.profileId,
          model: target.modelName,
          received: probe,
          saved,
        });
      },
      onResponses: async (reasoningCapabilities) => {
        await this.updateChatProfileAfterProbe(target, (profile) => {
          profile.reasoningCapabilities = reasoningCapabilities;
          profile.reasoning.summary = reasoningCapabilities.summary ? "auto" : "off";
          if (!profile.reasoning.effort && reasoningCapabilities.defaultEffort) {
            profile.reasoning.effort = reasoningCapabilities.defaultEffort;
          }
          profile.reasoning.mode = resolvedAgenticModeAfterProbe(
            profile.reasoning.mode,
            reasoningCapabilities,
          );
        });
        this.publishState(target.profileId, {
          agent: reasoningCapabilities.responses ? "verified" : "not-verified",
        });
        this.plugin.logger.logProbeResult({
          probe: "responses-capabilities",
          profileId: target.profileId,
          model: target.modelName,
          received: reasoningCapabilities,
          saved: reasoningCapabilities,
        });
      },
      onReasoning: async (result) => {
        const currentProfile = this.plugin.settings.chatModelProfiles.find(
          (candidate) =>
            candidate.id === target.profileId &&
            candidate.serverProfileId === target.serverProfileId &&
            candidate.modelName === target.modelName,
        );
        if (!currentProfile) return;
        const identity = {
          baseUrl: server.baseUrl,
          apiKey: server.apiKey,
          model: target.modelName,
          protocol: "chat-completions" as const,
        };
        const key = capabilityCacheKey(identity);
        const current =
          this.plugin.settings.modelCapabilityCache[key] ?? unknownSnapshot(result.checkedAt);
        const snapshot: ModelCapabilitySnapshot = {
          ...current,
          reasoning: {
            ...current.reasoning,
            visibleOutput: result.visible ? "supported" : "unsupported",
          },
          source: "probe",
          checkedAt: result.checkedAt,
          expiresAt: result.expiresAt,
        };
        this.plugin.settings.modelCapabilityCache[key] = snapshot;
        await this.plugin.saveSettings();
        this.plugin.logger.logProbeResult({
          probe: "reasoning-visibility",
          profileId: target.profileId,
          model: target.modelName,
          received: result,
          saved: { cacheKey: key, snapshot },
        });
        this.requestRedisplay();
      },
      onToolsError: () => {
        this.publishState(target.profileId, { tools: "failed" });
        new Notice(
          this.plugin.translate("settings.prober.toolCapabilityDetectionFailed", {
            profile: savedProfile.name,
          }),
        );
      },
      onResponsesError: () => {
        this.publishState(target.profileId, { agent: "failed" });
        new Notice(
          this.plugin.translate("settings.prober.agentCapabilityDetectionFailed", {
            profile: savedProfile.name,
          }),
        );
      },
      onReasoningError: () =>
        new Notice(
          this.plugin.translate("settings.prober.capabilityDetectionFailed", {
            profile: savedProfile.name,
          }),
        ),
    });
  }

  private reasoningEffortsFromCache(
    server: ServerProfile,
    modelName: string,
  ): string[] | undefined {
    for (const protocol of ["responses", "chat-completions"] as const) {
      const snapshot =
        this.plugin.settings.modelCapabilityCache[
          capabilityCacheKey({
            baseUrl: server.baseUrl,
            apiKey: server.apiKey,
            model: modelName,
            protocol,
          })
        ];
      if (snapshot) {
        const efforts = reasoningEffortCandidates(snapshot);
        if (efforts.length > 0) return efforts;
      }
    }
    return undefined;
  }

  private async verifyEmbeddingForServer(
    server: ServerProfile,
    modelName: string,
  ): Promise<boolean> {
    return verifyEmbeddingCapability(server, modelName, { logger: this.plugin.logger });
  }

  private async probeToolsForServer(
    server: ServerProfile,
    modelName: string,
  ): Promise<ToolCapabilityProbeResult> {
    return probeToolControlCapabilities({
      provider: new ChatModelClient({
        apiFormat: server.apiFormat,
        baseUrl: server.baseUrl,
        apiKey: server.apiKey,
        logger: this.plugin.logger,
      }),
      model: modelName,
      apiFormat: server.apiFormat,
    });
  }

  private async updateChatProfileAfterProbe(
    target: { profileId: string; serverProfileId: string; modelName: string },
    update: (profile: ChatModelProfile) => void,
  ): Promise<void> {
    const profile = this.plugin.settings.chatModelProfiles.find(
      (candidate) =>
        candidate.id === target.profileId &&
        candidate.serverProfileId === target.serverProfileId &&
        candidate.modelName === target.modelName,
    );
    if (!profile) return;
    update(profile);
    profile.updatedAt = new Date().toISOString();
    await this.plugin.saveSettings();
    this.requestRedisplay();
  }
}
