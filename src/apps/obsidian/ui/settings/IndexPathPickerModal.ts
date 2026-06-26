import { App, Modal, Setting, TAbstractFile, TFile, TFolder, setIcon } from "obsidian";

import { isHiddenOrIgnoredPath, isSupportedIndexFile, normalizePickerPath } from "./indexPath";
import { renderModalActions } from "./shared";

export interface IndexPathPickerModalOptions {
  selectedPaths: string[];
  onSubmit(paths: string[]): void;
}

export class IndexPathPickerModal extends Modal {
  private selectedPaths = new Set(this.options.selectedPaths.map(normalizePickerPath));
  private expandedFolders = new Set<string>();
  private query = "";
  private treeEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly options: IndexPathPickerModalOptions,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ixplorer-profile-modal");
    contentEl.createEl("h2", { text: "Choose files and folders" });

    new Setting(contentEl).setName("Search").addSearch((search) =>
      search.setPlaceholder("Filter files and folders").onChange((value) => {
        this.query = value.trim().toLocaleLowerCase();
        this.renderTree();
      }),
    );

    this.treeEl = contentEl.createDiv({ cls: "ixplorer-index-path-picker" });
    this.renderTree();

    renderModalActions(contentEl, {
      onCancel: () => this.close(),
      onSave: () => {
        this.options.onSubmit(Array.from(this.selectedPaths).sort());
        this.close();
      },
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderTree(): void {
    if (!this.treeEl) {
      return;
    }

    this.treeEl.empty();
    if (this.query) {
      this.renderSearchResults(this.treeEl);
      return;
    }

    this.renderFolderChildren(this.treeEl, this.app.vault.getRoot(), 0);
  }

  private renderSearchResults(containerEl: HTMLElement): void {
    const matches = this.app.vault
      .getAllLoadedFiles()
      .filter(
        (file) => this.shouldShowPath(file) && file.path.toLocaleLowerCase().includes(this.query),
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(0, 200);

    if (matches.length === 0) {
      containerEl.createDiv({
        cls: "ixplorer-profile-modal__model-empty",
        text: "No matching paths",
      });
      return;
    }

    for (const file of matches) {
      this.renderPathRow(containerEl, file, 0);
    }
  }

  private renderFolderChildren(containerEl: HTMLElement, folder: TFolder, depth: number): void {
    const children = folder.children
      .filter((child) => this.shouldShowPath(child))
      .sort((left, right) => {
        const leftFolder = left instanceof TFolder ? 0 : 1;
        const rightFolder = right instanceof TFolder ? 0 : 1;
        return leftFolder - rightFolder || left.name.localeCompare(right.name);
      });

    for (const child of children) {
      this.renderPathRow(containerEl, child, depth);
    }
  }

  private renderPathRow(containerEl: HTMLElement, file: TAbstractFile, depth: number): void {
    const path = normalizePickerPath(file.path);
    const row = containerEl.createDiv({
      cls: "ixplorer-index-path-picker__row",
      attr: { style: `padding-left: ${depth * 1.25}rem` },
    });

    if (file instanceof TFolder) {
      const expandButton = row.createEl("button", {
        cls: "clickable-icon ixplorer-index-path-picker__expand",
        attr: { type: "button", "aria-label": `Toggle ${file.path || "vault root"}` },
      });
      setIcon(expandButton, this.expandedFolders.has(path) ? "chevron-down" : "chevron-right");
      expandButton.addEventListener("click", () => {
        if (this.expandedFolders.has(path)) {
          this.expandedFolders.delete(path);
        } else {
          this.expandedFolders.add(path);
        }
        this.renderTree();
      });
    } else {
      row.createSpan({ cls: "ixplorer-index-path-picker__spacer" });
    }

    const checkbox = row.createEl("input", {
      attr: {
        type: "checkbox",
        "aria-label": `Select ${file.path}`,
      },
    });
    checkbox.checked = this.isSelected(file);
    checkbox.addEventListener("change", () => {
      this.togglePath(file, checkbox.checked);
      this.renderTree();
    });
    row.createSpan({ text: file.path || "/" });

    if (file instanceof TFolder && this.expandedFolders.has(path)) {
      this.renderFolderChildren(containerEl, file, depth + 1);
    }
  }

  private togglePath(file: TAbstractFile, selected: boolean): void {
    const path = normalizePickerPath(file.path);
    if (!selected) {
      const selectedAncestor = this.findSelectedAncestor(path);
      if (selectedAncestor) {
        this.selectedPaths.delete(selectedAncestor);
        const ancestor = this.app.vault.getAbstractFileByPath(selectedAncestor);
        if (ancestor instanceof TFolder) {
          for (const descendantPath of this.collectSupportedFilePaths(ancestor)) {
            if (descendantPath !== path && !descendantPath.startsWith(`${path}/`)) {
              this.selectedPaths.add(descendantPath);
            }
          }
        }
      }
      this.removePathAndDescendants(path);
      return;
    }

    this.removeDescendants(path);
    this.selectedPaths.add(path);
  }

  private isSelected(file: TAbstractFile): boolean {
    const path = normalizePickerPath(file.path);
    return (
      this.selectedPaths.has(path) ||
      Array.from(this.selectedPaths).some((selectedPath) => path.startsWith(`${selectedPath}/`))
    );
  }

  private removePathAndDescendants(path: string): void {
    for (const selectedPath of Array.from(this.selectedPaths)) {
      if (
        selectedPath === path ||
        selectedPath.startsWith(`${path}/`) ||
        path.startsWith(`${selectedPath}/`)
      ) {
        this.selectedPaths.delete(selectedPath);
      }
    }
  }

  private removeDescendants(path: string): void {
    for (const selectedPath of Array.from(this.selectedPaths)) {
      if (selectedPath.startsWith(`${path}/`)) {
        this.selectedPaths.delete(selectedPath);
      }
    }
  }

  private findSelectedAncestor(path: string): string | undefined {
    return Array.from(this.selectedPaths).find(
      (selectedPath) => path !== selectedPath && path.startsWith(`${selectedPath}/`),
    );
  }

  private collectSupportedFilePaths(folder: TFolder): string[] {
    const paths: string[] = [];
    for (const child of folder.children) {
      if (!this.shouldShowPath(child)) {
        continue;
      }

      if (child instanceof TFolder) {
        paths.push(...this.collectSupportedFilePaths(child));
      } else if (child instanceof TFile) {
        paths.push(normalizePickerPath(child.path));
      }
    }
    return paths;
  }

  private shouldShowPath(file: TAbstractFile): boolean {
    if (isHiddenOrIgnoredPath(file.path, this.getIgnoredGlobs())) {
      return false;
    }

    if (file instanceof TFolder) {
      return true;
    }

    return file instanceof TFile && isSupportedIndexFile(file.path);
  }

  private getIgnoredGlobs(): string[] {
    const vaultWithConfig = this.app.vault as typeof this.app.vault & {
      getConfig?(key: string): unknown;
    };
    const value = vaultWithConfig.getConfig?.("userIgnoreFilters");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
}
