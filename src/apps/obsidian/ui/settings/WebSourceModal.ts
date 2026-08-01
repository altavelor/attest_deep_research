import { App, Modal, Notice, Setting } from "obsidian";

import { areCredentialsComplete, WebSourceDescriptor, WebSourceProfile } from "@core/web";
import { renderModalActions } from "./shared";

export interface WebSourceModalOptions {
  descriptor: WebSourceDescriptor;
  profile: WebSourceProfile;
  onSave(profile: WebSourceProfile): Promise<void>;
}

/** Credential form generated from the catalog descriptor — one modal for every source. */
export class WebSourceModal extends Modal {
  private readonly credentials: Record<string, string> = {
    ...this.options.profile.credentials,
  };
  constructor(
    app: App,
    private readonly options: WebSourceModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const { descriptor } = this.options;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", { text: `Configure ${descriptor.label}` });

    const info = contentEl.createEl("p", { cls: "ixplorer-websource-modal__info" });
    info.appendText(`${descriptor.freeTierNote}. `);
    info.createEl("a", {
      text: "Provider documentation",
      href: descriptor.homepage,
      attr: { target: "_blank", rel: "noopener" },
    });

    for (const field of descriptor.credentials) {
      new Setting(contentEl)
        .setName(field.label)
        .setDesc(field.optional ? "Optional." : "Required to enable this source.")
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

    renderModalActions(contentEl, {
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
    if (!configured && this.options.profile.enabled) {
      new Notice(`${this.options.descriptor.label} disabled: required credentials are missing.`);
    }

    await this.options.onSave({
      sourceId: this.options.descriptor.id,
      enabled: this.options.profile.enabled && configured,
      credentials,
    });
    this.close();
  }
}
