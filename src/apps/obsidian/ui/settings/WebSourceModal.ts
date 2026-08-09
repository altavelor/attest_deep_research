import { App, Modal, Notice, Setting } from "obsidian";

import {
  areCredentialsComplete,
  isWebSourceActive,
  WebSourceDescriptor,
  WebSourceProfile,
} from "@core/web";
import type { Translate } from "@adapters/i18n";
import type { TextDirection } from "@core/i18n";
import { renderModalActions } from "./shared";

export interface WebSourceModalOptions {
  t: Translate;
  getDirection?(): TextDirection;
  descriptor: WebSourceDescriptor;
  profile: WebSourceProfile;
  onSave(profile: WebSourceProfile): Promise<void>;
}

/** Credential form generated from the catalog descriptor — one modal for every source. */
export class WebSourceModal extends Modal {
  private readonly credentials: Record<string, string> = {
    ...this.options.profile.credentials,
  };
  private imageSearchEnabled = this.options.profile.imageSearchEnabled === true;
  constructor(
    app: App,
    private readonly options: WebSourceModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.setAttr("dir", this.options.getDirection?.() ?? "ltr");
    const { contentEl } = this;
    const { descriptor, t } = this.options;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", {
      text: t("settings.webSourceModal.title", { source: descriptor.label }),
    });

    const info = contentEl.createEl("p", { cls: "ixplorer-websource-modal__info" });
    info.appendText(t("settings.webSourceModal.info", { note: descriptor.freeTierNote }));
    info.createEl("a", {
      text: t("settings.webSourceModal.providerDocs"),
      href: descriptor.homepage,
      attr: { target: "_blank", rel: "noopener" },
    });

    for (const field of descriptor.credentials) {
      new Setting(contentEl)
        .setName(field.label)
        .setDesc(
          field.optional
            ? t("settings.webSourceModal.field.optional")
            : t("settings.webSourceModal.field.required"),
        )
        .addText((text) => {
          if (field.secret) {
            text.inputEl.type = "password";
          }
          if (field.placeholder) {
            text.setPlaceholder(field.placeholder);
          }
          text.setValue(this.credentials[field.key] ?? "").onChange((value) => {
            this.credentials[field.key] = value.trim();
          });
        });
    }

    if (descriptor.capabilities?.images === true) {
      new Setting(contentEl)
        .setName(t("settings.webSourceModal.imageSearch.name"))
        .setDesc(t("settings.webSourceModal.imageSearch.desc"))
        .addToggle((toggle) => {
          toggle.setValue(this.imageSearchEnabled).onChange((value) => {
            this.imageSearchEnabled = value;
          });
        });
    }

    renderModalActions(contentEl, {
      t,
      onCancel: () => this.close(),
      onSave: () => void this.save(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    const credentials = Object.fromEntries(
      Object.entries(this.credentials).filter(([, value]) => value.length > 0),
    );
    const configured = areCredentialsComplete(this.options.descriptor, credentials);
    const active = isWebSourceActive(this.options.profile);
    if (!configured && active) {
      new Notice(
        this.options.t("settings.webSourceModal.disabledNotice", {
          source: this.options.descriptor.label,
        }),
      );
    }

    await this.options.onSave({
      sourceId: this.options.descriptor.id,
      activation: configured ? this.options.profile.activation : "off",
      credentials,
      ...(this.options.descriptor.capabilities?.images === true && this.imageSearchEnabled
        ? { imageSearchEnabled: true }
        : {}),
    });
    this.close();
  }
}
