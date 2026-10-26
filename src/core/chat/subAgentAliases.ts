import { subAgentAliasPrefix, type SubAgentStateSnapshot } from "@core/research";
import type { ConversationSource, ConversationSourceRegistry } from "./sourceRegistry";

/**
 * Removes conversation aliases left by tombstoned sub-agent imports. Only revisions
 * that no message cites lose alias chunks; a revision left empty is dropped, a source
 * without revisions disappears and a source that lost its active revision reactivates
 * its newest remaining one, so cited artifacts and parent evidence always stay.
 */
export function removeOrphanSubAgentAliases(
  registry: ConversationSourceRegistry,
  section: SubAgentStateSnapshot,
): ConversationSourceRegistry {
  const prefixes = section.imports
    .filter((entry) => entry.state === "tombstoned")
    .map((entry) => subAgentAliasPrefix(entry.importId));
  if (prefixes.length === 0) return registry;
  const orphan = (id: string): boolean => prefixes.some((prefix) => id.startsWith(prefix));
  let changed = false;
  const sources: ConversationSource[] = [];
  for (const source of registry.sources) {
    const revisions = source.revisions.flatMap((revision) => {
      if (revision.usages.length > 0 || !revision.chunks.some((chunk) => orphan(chunk.id))) {
        return [revision];
      }
      changed = true;
      const chunks = revision.chunks.filter((chunk) => !orphan(chunk.id));
      return chunks.length > 0 ? [{ ...revision, chunks }] : [];
    });
    if (revisions.length === 0) continue;
    const hadActive = source.revisions.some((revision) => revision.status === "active");
    if (hadActive && !revisions.some((revision) => revision.status === "active")) {
      const newest = revisions.length - 1;
      revisions[newest] = { ...revisions[newest], status: "active" };
    }
    sources.push({ ...source, revisions });
  }
  return changed ? { sources } : registry;
}
