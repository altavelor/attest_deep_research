export function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}

export function normalizeVaultFolder(folder: string): string {
  const normalized = normalizeVaultPath(folder.trim()).replace(/\/+$/, "");

  return normalized === "." ? "" : normalized;
}

export function isInternalSkillPath(path: string): boolean {
  const normalized = normalizeVaultPath(path);
  return normalized === ".ixplorer/skills" || normalized.startsWith(".ixplorer/skills/");
}

export function isSupportedContextDocumentPath(path: string): boolean {
  return !isInternalSkillPath(path) && /\.(md|pdf|txt|docx|epub|fb2)$/i.test(path);
}

export function isPathIncluded(path: string, includeFolders: string[]): boolean {
  return includeFolders.some((folder) => {
    const normalizedFolder = normalizeVaultFolder(folder);

    return (
      normalizedFolder === "" ||
      path === normalizedFolder ||
      path.startsWith(`${normalizedFolder}/`)
    );
  });
}

export function vaultPathMatchesGlob(path: string, glob: string): boolean {
  const normalizedGlob = normalizeVaultPath(glob.trim());

  if (!normalizedGlob) {
    return false;
  }

  return globToRegExp(normalizedGlob).test(path);
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const nextCharacter = glob[index + 1];

    if (character === "*" && nextCharacter === "*") {
      pattern += ".*";
      index += 1;
    } else if (character === "*") {
      pattern += "[^/]*";
    } else {
      pattern += escapeRegExp(character);
    }
  }

  return new RegExp(`${pattern}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}
