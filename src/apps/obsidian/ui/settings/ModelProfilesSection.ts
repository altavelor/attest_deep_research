import { DiscoveredModel } from "@adapters/settings";
import {
  capabilityTags,
  canDeleteEmbeddingModelProfile,
  canDeleteServerProfile,
  mergeChatProfileSettingsPreservingProbe,
} from "@adapters/settings";
import { App, Notice } from "obsidian";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { formatCapabilityStatus } from "./capabilityStatusText";
import { ModelProfileModal } from "./ModelProfileModal";
import { renderProfileList, renderProfileListItem } from "./ProfileListRenderer";
import { ServerProfileModal } from "./ServerProfileModal";
import { SettingsCapabilityProber } from "./SettingsCapabilityProber";
import { renderCategoryHeading, statusForProfile } from "./shared";
import type { AttestSettings } from "@adapters/settings";

export interface ModelProfilesSectionOptions {
  app: App;
  t: Translate;
  getDirection?(): TextDirection;
  settings: AttestSettings;
  fetchedModelsByServerId: Map<string, DiscoveredModel[]>;
  prober: SettingsCapabilityProber;
  saveSettings(): Promise<void>;
  requestRedisplay(): void;
}

/** Renders and manages server, chat-model, and embedding-model profiles. */
export class ModelProfilesSection {
  constructor(private readonly options: ModelProfilesSectionOptions) {}

  render(containerEl: HTMLElement): void {
    const { t } = this.options;
    renderCategoryHeading(containerEl, t("settings.models.heading"), t("settings.models.desc"));
    this.renderServers(containerEl);
    this.renderChatModels(containerEl);
    this.renderEmbeddingModels(containerEl);
  }

  private renderServers(containerEl: HTMLElement): void {
    const { settings, t } = this.options;
    const listEl = renderProfileList(t, containerEl, t("settings.models.server.title"), () => {
      new ServerProfileModal(this.options.app, {
        t,
        getDirection: this.options.getDirection,
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
        t,
        name: profile.name,
        status: statusForProfile(t, profile),
        onEdit: () =>
          new ServerProfileModal(this.options.app, {
            t,
            getDirection: this.options.getDirection,
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
          ? t("settings.models.server.deleteTooltip")
          : t("settings.models.server.deleteBlockedTooltip"),
        onDelete: async () => {
          if (!canDeleteServerProfile(settings, profile.id)) {
            new Notice(t("settings.models.server.deleteBlockedNotice"));
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
    const { settings, t } = this.options;
    const listEl = renderProfileList(t, containerEl, t("settings.models.chat.title"), () =>
      this.openChatModal(),
    );
    for (const profile of settings.chatModelProfiles) {
      const capability = this.options.prober.statusFor(profile);
      const isTesting = capability.tools === "testing" || capability.agent === "testing";
      renderProfileListItem(listEl, {
        t,
        name: profile.name,
        tags: capabilityTags(profile),
        status: statusForProfile(t, profile),
        onEdit: () => this.openChatModal(profile),
        extraActions: [
          {
            icon: "flask-conical",
            className: `attest-settings__test-capabilities-action${isTesting ? " is-testing" : ""}`,
            label: isTesting
              ? t("settings.models.chat.testingLabel")
              : formatCapabilityStatus(t, capability),
            disabled: isTesting,
            onClick: async () => {
              if (isTesting) return;
              await this.options.prober.refreshMetadataCapabilities();
              this.options.prober.startChatProfileProbes(profile.id, true);
              new Notice(t("settings.models.chat.testingNotice", { profile: profile.name }));
            },
          },
        ],
        canDelete: true,
        deleteTooltip: t("settings.models.chat.deleteTooltip"),
        onDelete: async () => {
          settings.chatModelProfiles = settings.chatModelProfiles.filter(
            (candidate) => candidate.id !== profile.id,
          );
          await this.saveAndRedisplay();
        },
      });
    }
  }

  private openChatModal(profile?: AttestSettings["chatModelProfiles"][number]): void {
    const { settings } = this.options;
    new ModelProfileModal(this.options.app, {
      t: this.options.t,
      getDirection: this.options.getDirection,
      kind: "chat",
      profile,
      servers: settings.serverProfiles,
      profiles: settings.chatModelProfiles,
      fetchedModelsByServerId: this.options.fetchedModelsByServerId,
      fetchModels: (server) => this.options.prober.fetchModelsForServer(server, "chat"),
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
    const { settings, t } = this.options;
    const listEl = renderProfileList(t, containerEl, t("settings.models.embedding.title"), () =>
      this.openEmbeddingModal(),
    );
    for (const profile of settings.embeddingModelProfiles) {
      const canDelete = canDeleteEmbeddingModelProfile(settings, profile.id);
      renderProfileListItem(listEl, {
        t,
        name: profile.name,
        status:
          settings.activeEmbeddingModelProfileId === profile.id && !profile.isSuspended
            ? {
                kind: "is-default",
                label: t("settings.models.embedding.defaultBadge"),
                title: t("settings.models.embedding.defaultBadgeTitle"),
              }
            : statusForProfile(t, profile),
        onEdit: () => this.openEmbeddingModal(profile),
        extraActions: [
          {
            icon: "star",
            className: "attest-settings__default-action",
            label:
              settings.activeEmbeddingModelProfileId === profile.id
                ? t("settings.models.embedding.defaultAction")
                : t("settings.models.embedding.setDefaultAction"),
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
          ? t("settings.models.embedding.deleteTooltip")
          : t("settings.models.embedding.deleteBlockedTooltip"),
        onDelete: async () => {
          if (!canDeleteEmbeddingModelProfile(settings, profile.id)) {
            new Notice(t("settings.models.embedding.deleteBlockedNotice"));
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

  private openEmbeddingModal(profile?: AttestSettings["embeddingModelProfiles"][number]): void {
    const { settings } = this.options;
    new ModelProfileModal(this.options.app, {
      t: this.options.t,
      getDirection: this.options.getDirection,
      kind: "embedding",
      profile,
      servers: settings.serverProfiles,
      profiles: settings.embeddingModelProfiles,
      fetchedModelsByServerId: this.options.fetchedModelsByServerId,
      fetchModels: (server) => this.options.prober.fetchModelsForServer(server, "embedding"),
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
