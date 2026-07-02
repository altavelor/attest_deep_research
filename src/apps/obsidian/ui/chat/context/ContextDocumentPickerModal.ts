import { Modal, setIcon, TFile } from "obsidian";
import { isSupportedContextDocumentPath } from "@shared";
import { isFolderAttachmentPath } from "./attachmentPaths";

export function isContextDocumentPath(path: string): boolean {
  return isSupportedContextDocumentPath(path);
}

interface TreeFolder {
  /** Folder attachment path — always with a trailing "/" ("" for the vault root). */
  path: string;
  name: string;
  folders: TreeFolder[];
  files: string[];
  /** Supported files in this subtree, for the folder row counter. */
  totalFiles: number;
}

/**
 * Vault file tree with checkboxes on both folders and files. Checking a folder
 * attaches the folder itself (stored as "path/"), covering everything inside;
 * covered rows render checked and disabled.
 */
export class ContextDocumentPickerModal extends Modal {
  private selectedPaths: Set<string>;
  private readonly expandedFolders = new Set<string>();
  private listEl: HTMLElement | null = null;
  private query = "";
  private readonly tree: TreeFolder;

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
    this.tree = buildTree(options.files.map((file) => file.path));
    // Folders that already contain a selection start expanded.
    for (const selected of this.selectedPaths) {
      for (const ancestor of ancestorFolders(selected)) {
        this.expandedFolders.add(ancestor);
      }
    }
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

    if (this.query) {
      this.renderFilteredList(this.listEl);
      return;
    }
    this.renderFolder(this.listEl, this.tree, 0);
  }

  /** Search keeps the pre-tree flat behavior: matching file paths only. */
  private renderFilteredList(containerEl: HTMLElement): void {
    const matches = this.options.files.filter((file) =>
      file.path.toLowerCase().includes(this.query),
    );
    for (const file of matches.slice(0, 250)) {
      this.renderFileRow(containerEl, file.path, 0);
    }
  }

  private renderFolder(containerEl: HTMLElement, folder: TreeFolder, depth: number): void {
    for (const child of folder.folders) {
      const row = containerEl.createDiv({ cls: "ixplorer-context-picker__row" });
      row.style.setProperty("--picker-depth", String(depth));

      const expanded = this.expandedFolders.has(child.path);
      const toggle = row.createEl("button", {
        cls: "ixplorer-context-picker__toggle",
        attr: {
          type: "button",
          "aria-label": expanded ? `Collapse ${child.name}` : `Expand ${child.name}`,
        },
      });
      setIcon(toggle, expanded ? "chevron-down" : "chevron-right");
      toggle.addEventListener("click", () => {
        if (expanded) {
          this.expandedFolders.delete(child.path);
        } else {
          this.expandedFolders.add(child.path);
        }
        this.renderList();
      });

      const label = row.createEl("label", {
        cls: "ixplorer-context-picker__item ixplorer-context-picker__item--folder",
      });
      const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
      const covered = this.isCoveredByFolder(child.path);
      checkbox.checked = covered || this.selectedPaths.has(child.path);
      checkbox.disabled = covered;
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectFolder(child.path);
        } else {
          this.selectedPaths.delete(child.path);
        }
        this.renderList();
      });
      setIcon(label.createSpan({ cls: "ixplorer-context-picker__icon" }), "folder");
      label.createSpan({ text: child.name });
      label.createSpan({
        cls: "ixplorer-context-picker__count",
        text: String(child.totalFiles),
      });

      if (expanded) {
        this.renderFolder(containerEl, child, depth + 1);
      }
    }

    for (const filePath of folder.files) {
      this.renderFileRow(containerEl, filePath, depth);
    }
  }

  private renderFileRow(containerEl: HTMLElement, filePath: string, depth: number): void {
    const row = containerEl.createDiv({ cls: "ixplorer-context-picker__row" });
    row.style.setProperty("--picker-depth", String(depth));
    row.createSpan({ cls: "ixplorer-context-picker__toggle-spacer" });

    const label = row.createEl("label", { cls: "ixplorer-context-picker__item" });
    const checkbox = label.createEl("input", { attr: { type: "checkbox" } });
    const covered = this.isCoveredByFolder(filePath);
    checkbox.checked = covered || this.selectedPaths.has(filePath);
    checkbox.disabled = covered;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        this.selectedPaths.add(filePath);
      } else {
        this.selectedPaths.delete(filePath);
      }
    });
    setIcon(label.createSpan({ cls: "ixplorer-context-picker__icon" }), "file-text");
    label.createSpan({ text: this.query ? filePath : baseName(filePath) });
  }

  /** Selecting a folder subsumes any previously selected descendants. */
  private selectFolder(folderPath: string): void {
    for (const selected of Array.from(this.selectedPaths)) {
      if (selected !== folderPath && selected.startsWith(folderPath)) {
        this.selectedPaths.delete(selected);
      }
    }
    this.selectedPaths.add(folderPath);
    this.expandedFolders.add(folderPath);
  }

  private isCoveredByFolder(path: string): boolean {
    for (const selected of this.selectedPaths) {
      if (isFolderAttachmentPath(selected) && path !== selected && path.startsWith(selected)) {
        return true;
      }
    }
    return false;
  }
}

function buildTree(filePaths: readonly string[]): TreeFolder {
  const root: TreeFolder = { path: "", name: "", folders: [], files: [], totalFiles: 0 };
  const folderIndex = new Map<string, TreeFolder>([["", root]]);

  const folderFor = (folderPath: string): TreeFolder => {
    const existing = folderIndex.get(folderPath);
    if (existing) {
      return existing;
    }
    const trimmed = folderPath.replace(/\/$/, "");
    const parentPath = trimmed.includes("/")
      ? `${trimmed.slice(0, trimmed.lastIndexOf("/"))}/`
      : "";
    const node: TreeFolder = {
      path: folderPath,
      name: trimmed.slice(trimmed.lastIndexOf("/") + 1),
      folders: [],
      files: [],
      totalFiles: 0,
    };
    folderIndex.set(folderPath, node);
    folderFor(parentPath).folders.push(node);
    return node;
  };

  for (const filePath of [...filePaths].sort((left, right) => left.localeCompare(right))) {
    const lastSlash = filePath.lastIndexOf("/");
    const parent = folderFor(lastSlash === -1 ? "" : `${filePath.slice(0, lastSlash)}/`);
    parent.files.push(filePath);
    for (const ancestor of ["", ...ancestorFolders(filePath)]) {
      const node = folderIndex.get(ancestor);
      if (node) {
        node.totalFiles += 1;
      }
    }
  }

  sortFolders(root);
  return root;
}

/** All ancestor folder paths of a path, each with a trailing "/". */
function ancestorFolders(path: string): string[] {
  const ancestors: string[] = [];
  const segments = path.replace(/\/$/, "").split("/");
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(`${segments.slice(0, index).join("/")}/`);
  }
  return ancestors;
}

function sortFolders(folder: TreeFolder): void {
  folder.folders.sort((left, right) => left.name.localeCompare(right.name));
  for (const child of folder.folders) {
    sortFolders(child);
  }
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
