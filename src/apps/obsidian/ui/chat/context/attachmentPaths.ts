import { isSupportedContextDocumentPath } from "@shared";

export function isFolderAttachmentPath(path: string): boolean {
  return path.endsWith("/");
}

/**
 * Expands folder attachments into the supported files they currently contain
 * (recursively); file attachments pass through. Deduplicated, vault order.
 */
export function expandAttachedContextPaths(
  attachedPaths: readonly string[],
  vaultFilePaths: readonly string[],
): string[] {
  const expanded = new Set<string>();
  for (const attached of attachedPaths) {
    if (!isFolderAttachmentPath(attached)) {
      expanded.add(attached);
      continue;
    }
    for (const filePath of vaultFilePaths) {
      if (filePath.startsWith(attached) && isSupportedContextDocumentPath(filePath)) {
        expanded.add(filePath);
      }
    }
  }
  return Array.from(expanded);
}
