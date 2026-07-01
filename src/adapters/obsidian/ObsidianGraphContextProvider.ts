import { MetadataCache, TFile, Vault } from "obsidian";

import { normalizeVaultPath } from "@shared";
import {
  createGraphCandidate,
  GraphContextDiscovery,
  GraphContextProvider,
  GraphContextRequest,
  parseMarkdownGraphLinks,
  resolveMarkdownLinkTarget,
} from "@core/research";

type GraphCandidate = ReturnType<typeof createGraphCandidate>;

export class ObsidianGraphContextProvider implements GraphContextProvider {
  constructor(
    private readonly vault: Vault,
    private readonly metadataCache: MetadataCache,
  ) { }

  async discover(request: GraphContextRequest): Promise<GraphContextDiscovery> {
    const availablePaths = new Set(request.availablePaths.map((path) => normalizeVaultPath(path)));
    const aliasIndex = this.buildAliasIndex(request.availablePaths);
    const roots = this.resolveQuestionRoots(request, aliasIndex);
    const rootPaths = uniquePaths([...request.roots.map((root) => root.path), ...roots]);
    const rootPathSet = new Set(rootPaths);
    const included = new Map<string, GraphCandidate>();
    const dropped: GraphCandidate[] = [];
    const unresolved: GraphCandidate[] = [];
    const queue = rootPaths.map((path) => ({ path, depth: 0 }));
    const visitedRoots = new Set<string>();
    let fallbackUsed = false;

    while (queue.length > 0) {
      const node = queue.shift()!;
      const rootPath = node.path;

      if (!availablePaths.has(rootPath)) {
        continue;
      }

      if (visitedRoots.has(`${rootPath}:${node.depth}`) || node.depth >= request.maxDepth) {
        continue;
      }

      visitedRoots.add(`${rootPath}:${node.depth}`);
      const discovered = await this.discoverFromRoot(
        rootPath,
        request,
        aliasIndex,
        node.depth + 1,
        node.depth === 0 && request.includeBacklinks,
      );
      fallbackUsed = fallbackUsed || discovered.fallbackUsed;

      for (const candidate of discovered.candidates) {
        if (rootPathSet.has(candidate.path)) {
          continue;
        }

        if (!availablePaths.has(candidate.path)) {
          dropped.push({ ...candidate, status: "unsupported", reason: "unsupported-file-type" });
          continue;
        }

        if (included.has(candidate.path)) {
          const existing = included.get(candidate.path)!;
          existing.edges.push(...candidate.edges);
          existing.score = (existing.score ?? 0) + (candidate.score ?? 0) * 0.25;
          continue;
        }

        if (included.size >= request.limits.maxGraphCandidatesTotal) {
          dropped.push({ ...candidate, status: "dropped", reason: "graph_candidate_limit" });
          continue;
        }

        included.set(candidate.path, candidate);
        if (
          node.depth + 1 < request.maxDepth &&
          candidate.edges.every((edge) => edge.type !== "backlink")
        ) {
          queue.push({ path: candidate.path, depth: node.depth + 1 });
        }
      }

      unresolved.push(...discovered.unresolved);
    }

    const sortedIncluded = Array.from(included.values()).sort(
      (left, right) => (right.score ?? 0) - (left.score ?? 0) || left.path.localeCompare(right.path),
    );

    return {
      sourcePaths: sortedIncluded.map((candidate) => candidate.path),
      diagnostics: {
        enabled: true,
        source: fallbackUsed ? "mixed" : "metadataCache",
        depth: request.maxDepth,
        rootPaths,
        included: sortedIncluded,
        dropped,
        unresolved,
        limits: request.limits,
      },
    };
  }

  private async discoverFromRoot(
    rootPath: string,
    request: GraphContextRequest,
    aliasIndex: Map<string, string[]>,
    edgeDepth: number,
    includeBacklinks: boolean,
  ): Promise<{
    candidates: GraphCandidate[];
    unresolved: GraphCandidate[];
    fallbackUsed: boolean;
  }> {
    const file = this.vault.getAbstractFileByPath(rootPath);

    if (!(file instanceof TFile)) {
      return { candidates: [], unresolved: [], fallbackUsed: false };
    }

    const cache = this.metadataCache.getFileCache(file);
    const links = cache?.links ?? [];
    const embeds = cache?.embeds ?? [];
    const candidates: GraphCandidate[] = [];
    const unresolved: GraphCandidate[] = [];
    let fallbackUsed = false;

    if (links.length === 0 && embeds.length === 0 && file.extension.toLowerCase() === "md") {
      fallbackUsed = true;
      const parsed = parseMarkdownGraphLinks(await this.vault.cachedRead(file));
      this.addParsedLinks(
        candidates,
        unresolved,
        parsed.links,
        rootPath,
        "forward_link",
        request,
        aliasIndex,
        edgeDepth,
      );
      this.addParsedLinks(
        candidates,
        unresolved,
        parsed.embeds,
        rootPath,
        "embed",
        request,
        aliasIndex,
        edgeDepth,
      );
    } else {
      this.addMetadataLinks(
        candidates,
        unresolved,
        links.slice(0, request.limits.maxForwardLinksPerRoot),
        rootPath,
        "forward_link",
        request,
        aliasIndex,
        edgeDepth,
      );
      this.addMetadataLinks(
        candidates,
        unresolved,
        embeds.slice(0, request.limits.maxEmbedsPerRoot),
        rootPath,
        "embed",
        request,
        aliasIndex,
        edgeDepth,
      );
    }

    if (includeBacklinks) {
      this.addBacklinks(candidates, rootPath, request, edgeDepth);
    }

    return { candidates, unresolved, fallbackUsed };
  }

  private addMetadataLinks(
    candidates: GraphCandidate[],
    unresolved: GraphCandidate[],
    links: Array<{ link?: string }>,
    rootPath: string,
    type: "forward_link" | "embed",
    request: GraphContextRequest,
    aliasIndex: Map<string, string[]>,
    edgeDepth: number,
  ): void {
    for (const link of links) {
      const target = typeof link.link === "string" ? link.link : "";
      const resolved = this.resolveLink(target, rootPath, request.availablePaths, aliasIndex);

      if (!resolved) {
        unresolved.push(createGraphCandidate(target || "(unknown)", "unresolved", {
          from: rootPath,
          type,
          depth: edgeDepth,
        }, "unresolved-link"));
        continue;
      }

      candidates.push(createGraphCandidate(resolved, "included", {
        from: rootPath,
        type,
        depth: edgeDepth,
      }, undefined, graphEdgeScore(type)));
    }
  }

  private addParsedLinks(
    candidates: GraphCandidate[],
    unresolved: GraphCandidate[],
    links: string[],
    rootPath: string,
    type: "forward_link" | "embed",
    request: GraphContextRequest,
    aliasIndex: Map<string, string[]>,
    edgeDepth: number,
  ): void {
    for (const link of links.slice(0, linkLimit(request, type))) {
      const resolved = resolveMarkdownLinkTarget(link, rootPath, request.availablePaths, aliasIndex);

      if (!resolved) {
        unresolved.push(createGraphCandidate(link, "unresolved", {
          from: rootPath,
          type,
          depth: edgeDepth,
        }, "unresolved-link"));
        continue;
      }

      candidates.push(createGraphCandidate(resolved, "included", {
        from: rootPath,
        type,
        depth: edgeDepth,
      }, undefined, graphEdgeScore(type)));
    }
  }

  private addBacklinks(
    candidates: GraphCandidate[],
    rootPath: string,
    request: GraphContextRequest,
    edgeDepth: number,
  ): void {
    const file = this.vault.getAbstractFileByPath(rootPath);

    if (!(file instanceof TFile)) {
      return;
    }

    const backlinkReader = this.metadataCache as MetadataCache & {
      getBacklinksForFile?(file: TFile): { data?: Record<string, unknown> };
    };
    const backlinkData = backlinkReader.getBacklinksForFile?.(file)?.data ?? {};
    const backlinkPaths = Object.keys(backlinkData).slice(0, request.limits.maxBacklinksPerRoot);

    for (const path of backlinkPaths) {
      candidates.push(createGraphCandidate(normalizeVaultPath(path), "included", {
        from: normalizeVaultPath(path),
        type: "backlink",
        depth: edgeDepth,
      }, undefined, graphEdgeScore("backlink")));
    }
  }

  private resolveQuestionRoots(
    request: GraphContextRequest,
    aliasIndex: Map<string, string[]>,
  ): string[] {
    const parsed = parseMarkdownGraphLinks(request.question);
    const roots: string[] = [];

    for (const link of [...parsed.links, ...parsed.embeds]) {
      const resolved = this.resolveLink(link, "", request.availablePaths, aliasIndex);

      if (resolved) {
        roots.push(resolved);
      }
    }

    return uniquePaths(roots);
  }

  private resolveLink(
    link: string,
    sourcePath: string,
    availablePaths: string[],
    aliasIndex: Map<string, string[]>,
  ): string | undefined {
    const resolved = this.metadataCache.getFirstLinkpathDest(link, sourcePath);

    if (resolved) {
      return normalizeVaultPath(resolved.path);
    }

    return resolveMarkdownLinkTarget(link, sourcePath, availablePaths, aliasIndex);
  }

  private buildAliasIndex(availablePaths: string[]): Map<string, string[]> {
    const index = new Map<string, string[]>();

    for (const path of availablePaths) {
      const file = this.vault.getAbstractFileByPath(path);

      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
        continue;
      }

      const aliases = this.metadataCache.getFileCache(file)?.frontmatter?.aliases;
      const values = Array.isArray(aliases) ? aliases : typeof aliases === "string" ? [aliases] : [];

      for (const alias of values) {
        if (typeof alias !== "string" || !alias.trim()) {
          continue;
        }

        const key = alias.trim().toLowerCase();
        index.set(key, [...(index.get(key) ?? []), normalizeVaultPath(path)]);
      }
    }

    return index;
  }
}

function linkLimit(request: GraphContextRequest, type: "forward_link" | "embed"): number {
  return type === "embed" ? request.limits.maxEmbedsPerRoot : request.limits.maxForwardLinksPerRoot;
}

function graphEdgeScore(type: "forward_link" | "embed" | "backlink"): number {
  if (type === "embed") {
    return 40;
  }

  return type === "forward_link" ? 30 : 20;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => normalizeVaultPath(path)).filter(Boolean)));
}
