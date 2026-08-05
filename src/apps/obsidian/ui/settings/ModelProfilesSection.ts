import { DiscoveredModel } from "@adapters/settings";
import {
  capabilityTags,
  canDeleteEmbeddingModelProfile,
  canDeleteServerProfile,
  formatCapabilityVerificationStatus,
  mergeChatProfileSettingsPreservingProbe,
} from "@adapters/settings";
import { App, Notice } from "obsidian";
import { ModelProfileModal } from "./ModelProfileModal";
import { renderProfileList, renderProfileListItem } from "./ProfileListRenderer";
import { ServerProfileModal } from "./ServerProfileModal";
import { SettingsCapabilityProber } from "./SettingsCapabilityProber";
import { renderCategoryHeading, statusForProfile } from "./shared";
import type { IxplorerSettings } from "@adapters/settings";

export interface ModelProfilesSectionOptions {
  app: App;
  settings: IxplorerSettings;
  fetchedModelsByServerId: Map<string, DiscoveredModel[]>;
  prober: SettingsCapabilityProber;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;
}

/** Renders and manages server, chat-model, and embedding-model profiles. */
export class ModelProfilesSection {
  constructor(private readonly options: ModelProfilesSectionOptions) {}

  render(containerEl: HTMLElement): void {
    renderCategoryHeading(
      containerEl,
      "Model profiles",
      "Configure provider endpoints and the chat or embedding models that use them.",
    );
    this.renderServers(containerEl);
    this.renderChatModels(containerEl);
    this.renderEmbeddingModels(containerEl);
  }

  private renderServers(containerEl: HTMLElement): void {
    const { settings } = this.options;
    const listEl = renderProfileList(containerEl, "Server profiles", () => {
      new ServerProfileModal(this.options.app, {
        profiles: settings.serverProfiles,
        onSave: async (profile) => {
          settings.serverProfiles.push(profile);
          await this.saveAndRedisplay();
        },
      }).open();
    });
    for (const profile of settings.serverProfiles) {
      const canDelete = canDeleteServerProfile(settings, profile.id);
      renderProfileListItem(listEl, {
        name: profile.name,
        status: statusForProfile(profile),
        onEdit: () =>
          new ServerProfileModal(this.options.app, {
            profile,
            profiles: settings.serverProfiles,
            onSave: async (updated) => {
              Object.assign(profile, updated, { updatedAt: new Date().toISOString() });
              this.options.fetchedModelsByServerId.delete(profile.id);
              await this.saveAndRedisplay();
            },
          }).open(),
        canDelete,
        deleteTooltip: canDelete
          ? "Delete server profile"
          : "Delete dependent model profiles first",
        onDelete: async () => {
          if (!canDeleteServerProfile(settings, profile.id)) {
            new Notice("Delete dependent model profiles first.");
            return;
          }
          settings.serverProfiles = settings.serverProfiles.filter(
            (candidate) => candidate.id !== profile.id,
          );
          await this.saveAndRedisplay();
        },
      });
    }
  }

  private renderChatModels(containerEl: HTMLElement): void {
    const { settings } = this.options;
    const listEl = renderProfileList(containerEl, "Chat model profiles", () =>
      this.openChatModal(),
    );
    for (const profile of settings.chatModelProfiles) {
      const capability = this.options.prober.statusFor(profile);
      const isTesting = capability.tools === "testing" || capability.agent === "testing";
      renderProfileListItem(listEl, {
        name: profile.name,
        tags: capabilityTags(profile),
        status: statusForProfile(profile),
        onEdit: () => this.openChatModal(profile),
        extraActions: [
          {
            icon: "flask-conical",
            className: `ixplorer-settings__test-capabilities-action${isTesting ? " is-testing" : ""}`,
            label: isTesting
              ? "Testing capabilities…"
              : formatCapabilityVerificationStatus(capability),
            onClick: async () => {
              await this.options.prober.refreshMetadataCapabilities();
              this.options.prober.startChatProfileProbes(profile.id, true);
              new Notice(`Testing capabilities for ${profile.name}.`);
            },
          },
        ],
        canDelete: true,
        deleteTooltip: "Delete chat model profile",
        onDelete: async () => {
          settings.chatModelProfiles = settings.chatModelProfiles.filter(
            (candidate) => candidate.id !== profile.id,
          );
          await this.saveAndRedisplay();
        },
      });
    }
  }

  private openChatModal(profile?: IxplorerSettings["chatModelProfiles"][number]): void {
    const { settings } = this.options;
    new ModelProfileModal(this.options.app, {
      kind: "chat",
      profile,
      servers: settings.serverProfiles,
      profiles: settings.chatModelProfiles,
      fetchedModelsByServerId: this.options.fetchedModelsByServerId,
      fetchModels: (server) => this.options.prober.fetchModelsForServer(server),
      fetchContextLength: (server, name) =>
        this.options.prober.fetchContextLengthForModel(server, name),
      onSave: async (saved) => {
        const index = settings.chatModelProfiles.findIndex(
          (candidate) => candidate.id === saved.id,
        );
        if (index < 0) settings.chatModelProfiles.push(saved);
        else
          Object.assign(
            settings.chatModelProfiles[index],
            profile ? mergeChatProfileSettingsPreservingProbe(profile, saved) : saved,
            { updatedAt: new Date().toISOString() },
          );
        if (settings.chatModelProfiles.length === 1)
          settings.newChatDefaults.chatModelProfileId = saved.id;
        await this.saveAndRedisplay();
      },
      onTest: async (saved) => this.options.prober.startChatProfileProbes(saved.id, true),
      getCapabilityStatus: (id) =>
        this.options.prober.statusFor(
          settings.chatModelProfiles.find((candidate) => candidate.id === id) ?? profile!,
        ),
      subscribeCapabilityStatus: (listener) => this.options.prober.subscribeAll(listener),
      resolveProfile: (id) => settings.chatModelProfiles.find((candidate) => candidate.id === id),
    }).open();
  }

  private renderEmbeddingModels(containerEl: HTMLElement): void {
    const { settings } = this.options;
    const listEl = renderProfileList(containerEl, "Embedding model profiles", () =>
      this.openEmbeddingModal(),
    );
    for (const profile of settings.embeddingModelProfiles) {
      const canDelete = canDeleteEmbeddingModelProfile(settings, profile.id);
      renderProfileListItem(listEl, {
        name: profile.name,
        status:
          settings.activeEmbeddingModelProfileId === profile.id && !profile.isSuspended
            ? { kind: "is-default", label: "Default", title: "Default embedding model" }
            : statusForProfile(profile),
        onEdit: () => this.openEmbeddingModal(profile),
        extraActions: [
          {
            icon: "star",
            className: "ixplorer-settings__default-action",
            label:
              settings.activeEmbeddingModelProfileId === profile.id
                ? "Default model"
                : "Set as default model",
            disabled:
              profile.isSuspended === true || settings.activeEmbeddingModelProfileId === profile.id,
            onClick: async () => {
              settings.activeEmbeddingModelProfileId = profile.id;
              await this.saveAndRedisplay();
            },
          },
        ],
        canDelete,
        deleteTooltip: canDelete
          ? "Delete embedding model profile"
          : "This embedding model is used by an index profile",
        onDelete: async () => {
          if (!canDeleteEmbeddingModelProfile(settings, profile.id)) {
            new Notice("This embedding model is used by an index profile.");
            return;
          }
          settings.embeddingModelProfiles = settings.embeddingModelProfiles.filter(
            (candidate) => candidate.id !== profile.id,
          );
          await this.saveAndRedisplay();
        },
      });
    }
  }

  private openEmbeddingModal(profile?: IxplorerSettings["embeddingModelProfiles"][number]): void {
    const { settings } = this.options;
    new ModelProfileModal(this.options.app, {
      kind: "embedding",
      profile,
      servers: settings.serverProfiles,
      profiles: settings.embeddingModelProfiles,
      fetchedModelsByServerId: this.options.fetchedModelsByServerId,
      fetchModels: (server) => this.options.prober.fetchModelsForServer(server),
      onSave: async (saved) => {
        const existing = settings.embeddingModelProfiles.find(
          (candidate) => candidate.id === saved.id,
        );
        if (existing) Object.assign(existing, saved, { updatedAt: new Date().toISOString() });
        else settings.embeddingModelProfiles.push(saved);
        await this.saveAndRedisplay();
        this.options.prober.startEmbeddingProfileProbe(saved.id);
      },
    }).open();
  }

  private async saveAndRedisplay(): Promise<void> {
    await this.options.saveSettings();
    this.options.requestRedisplay();
  }
}
