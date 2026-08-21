import {
  ContextGraphCandidateDiagnostic,
  ContextGraphDiagnostics,
  ContextSourceRole,
  GraphEdgeType,
} from "@core/diagnostics";

export interface GraphRoot {
  path: string;
  role: ContextSourceRole;
}

export interface GraphContextLimits {
  maxForwardLinksPerRoot: number;
  maxEmbedsPerRoot: number;
  maxBacklinksPerRoot: number;
  maxGraphCandidatesTotal: number;
}

export interface GraphContextRequest {
  question: string;
  roots: GraphRoot[];
  availablePaths: string[];
  includeBacklinks: boolean;
  maxDepth: 1 | 2;
  limits: GraphContextLimits;
}

export interface GraphContextDiscovery {
  sourcePaths: string[];
  diagnostics: ContextGraphDiagnostics;
}

export interface GraphContextProvider {
  discover(request: GraphContextRequest): Promise<GraphContextDiscovery>;
}

export interface ParsedGraphLinks {
  links: string[];
  embeds: string[];
}

export interface GraphLinkResolver {
  resolve(link: string, sourcePath: string): string | undefined;
}

export const DEFAULT_GRAPH_CONTEXT_LIMITS: GraphContextLimits = {
  maxForwardLinksPerRoot: 20,
  maxEmbedsPerRoot: 20,
  maxBacklinksPerRoot: 20,
  maxGraphCandidatesTotal: 40,
};

export function createDisabledGraphDiagnostics(
  limits: GraphContextLimits = DEFAULT_GRAPH_CONTEXT_LIMITS,
): ContextGraphDiagnostics {
  return {
    enabled: false,
    source: "none",
    depth: 0,
    rootPaths: [],
    included: [],
    dropped: [],
    unresolved: [],
    limits,
  };
}

export function parseMarkdownGraphLinks(markdown: string): ParsedGraphLinks {
  const text = stripIgnoredMarkdownRegions(markdown);
  const links: string[] = [];
  const embeds: string[] = [];
  const seenLinks = new Set<string>();
  const seenEmbeds = new Set<string>();
  const wikiPattern = /(!?)\[\[([^\]\n]+)\]\]/g;
  const markdownLinkPattern = /(?<!!)\[[^\]\n]+\]\(([^)\n]+\.md(?:#[^)\n]+)?)\)/gi;
  let wikiMatch: RegExpExecArray | null;

  while ((wikiMatch = wikiPattern.exec(text)) !== null) {
    const isEmbed = wikiMatch[1] === "!";
    const target = normalizeLinkTarget(wikiMatch[2]);

    if (!target) {
      continue;
    }

    if (isEmbed) {
      addUnique(embeds, seenEmbeds, target);
    } else {
      addUnique(links, seenLinks, target);
    }
  }

  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownLinkPattern.exec(text)) !== null) {
    const target = normalizeLinkTarget(decodeURIComponentSafe(markdownMatch[1]));

    if (target) {
      addUnique(links, seenLinks, target);
    }
  }

  return { links, embeds };
}

export function resolveMarkdownLinkTarget(
  link: string,
  sourcePath: string,
  availablePaths: string[],
  aliasIndex?: Map<string, string[]>,
): string | undefined {
  const target = normalizeLinkTarget(link);

  if (!target) {
    return undefined;
  }

  const withoutAnchor = stripAnchor(target);
  const normalizedTarget = normalizeVaultPath(withoutAnchor);
  const exactPath = findCaseInsensitivePath(availablePaths, normalizedTarget);

  if (exactPath) {
    return exactPath;
  }

  const relativePath = resolveRelativePath(sourcePath, normalizedTarget);
  const exactRelative = findCaseInsensitivePath(availablePaths, relativePath);

  if (exactRelative) {
    return exactRelative;
  }

  const withMarkdownExtension = normalizedTarget.endsWith(".md")
    ? normalizedTarget
    : `${normalizedTarget}.md`;
  const exactWithExtension = findCaseInsensitivePath(availablePaths, withMarkdownExtension);

  if (exactWithExtension) {
    return exactWithExtension;
  }

  const basenameMatches = availablePaths.filter((path) => {
    const basename = path.split("/").pop() ?? path;

    return basename.toLowerCase().replace(/\.md$/i, "") === normalizedTarget.toLowerCase();
  });

  if (basenameMatches.length === 1) {
    return basenameMatches[0];
  }

  const aliasMatches = aliasIndex?.get(normalizedTarget.toLowerCase()) ?? [];

  return aliasMatches.length === 1 ? aliasMatches[0] : undefined;
}

export function createGraphCandidate(
  path: string,
  status: ContextGraphCandidateDiagnostic["status"],
  edge: {
    from: string;
    type: GraphEdgeType;
    depth: number;
  },
  reason?: string,
  score?: number,
): ContextGraphCandidateDiagnostic {
  return {
    path,
    status,
    reason,
    score,
    edges: [
      {
        from: edge.from,
        to: path,
        type: edge.type,
        depth: edge.depth,
      },
    ],
  };
}

function stripIgnoredMarkdownRegions(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?^---/m, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

function normalizeLinkTarget(target: string): string {
  const withoutAlias = target.split("|")[0]?.trim() ?? "";

  return withoutAlias.replace(/^<|>$/g, "").trim();
}

function stripAnchor(target: string): string {
  return target.split("#")[0]?.trim() ?? "";
}

function resolveRelativePath(sourcePath: string, target: string): string {
  if (target.startsWith("/")) {
    return normalizeVaultPath(target);
  }

  const sourceFolder = sourcePath.includes("/")
    ? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
    : "";

  return normalizeVaultPath(`${sourceFolder}/${target}`);
}

function findCaseInsensitivePath(paths: string[], target: string): string | undefined {
  const normalized = normalizeVaultPath(target).toLowerCase();

  return paths.find((path) => normalizeVaultPath(path).toLowerCase() === normalized);
}

function normalizeVaultPath(path: string): string {
  const parts: string[] = [];

  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      parts.pop();
      continue;
    }

    parts.push(segment);
  }

  return parts.join("/");
}

function addUnique(values: string[], seen: Set<string>, value: string): void {
  const key = value.toLowerCase();

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  values.push(value);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
