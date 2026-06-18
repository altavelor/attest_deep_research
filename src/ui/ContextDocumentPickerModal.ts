import { Modal, TFile } from "obsidian";
import { isSupportedContextDocumentPath } from "../shared/pathFilters";

export function isContextDocumentPath(path: string): boolean {
  return isSupportedContextDocumentPath(path);
}

export class ContextDocumentPickerModal extends Modal {
  private selectedPaths: Set<string>;
  private listEl: HTMLElement | null = null;
  private query = "";

  constructor(
    app: ConstructorParameters<typeof Modal>[0],
    private readonly options: {
      files: TFile[];
      selectedPaths: string[];
      onSubmit: (paths: string[]) => void;
    },
  ) {
    super(app);
    this.selectedPaths = new Set(options.selectedPaths);
  }

  onOpen(): void {
    this.titleEl.setText("Attach context documents");
    this.contentEl.empty();
    this.contentEl.addClass("ixplorer-context-picker");

    const search = this.contentEl.createEl("input", {
      cls: "ixplorer-context-picker__search",
      attr: {
        type: "search",
        placeholder: "Filter documents",
        "aria-label": "Filter documents",
      },
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.renderList();
    });

    this.listEl = this.contentEl.createDiv({ cls: "ixplorer-context-picker__list" });
    this.renderList();

    const actions = this.contentEl.createDiv({ cls: "ixplorer-context-picker__actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.addEventListener("click", () => this.close());
    const apply = actions.createEl("button", {
      cls: "mod-cta",
      text: "Attach",
      attr: { type: "button" },
    });
    apply.addEventListener("click", () => {
      this.options.onSubmit(Array.from(this.selectedPaths).sort());
      this.close();
    });
  }

  private renderList(): void {
    if (!this.listEl) {
      return;
    }

    this.listEl.empty();
    const files = this.options.files.filter((file) => file.path.toLowerCase().includes(this.query));

    for (const file of files.slice(0, 250)) {
      const label = this.listEl.createEl("label", { cls: "ixplorer-context-picker__item" });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selectedPaths.has(file.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedPaths.add(file.path);
        } else {
          this.selectedPaths.delete(file.path);
        }
      });
      label.createSpan({ text: file.path });
    }
  }
}
