import { ContextDiagnostics, ContextMode, ContextSourceRole } from "@core/diagnostics";
import {
  createDisabledGraphDiagnostics,
  DEFAULT_GRAPH_CONTEXT_LIMITS,
  GraphContextProvider,
  GraphContextLimits,
  GraphRoot,
} from "@core/research";

export interface ContextGraphRequest {
  question: string;
  contextMode: ContextMode;
  contextPaths: string[];
  activeFilePath?: string;
  includeActiveFile?: boolean;
  graph?: {
    enabled: boolean;
    includeBacklinks: boolean;
    expandFilteredContextThroughLinks: boolean;
    depth: 1 | 2;
    limits?: Partial<GraphContextLimits>;
  };
}

/** Discovers graph-derived source paths from the explicit context roots. */
export class ContextGraphDiscovery {
  constructor(private readonly graph?: GraphContextProvider) {}

  async discover(
    request: ContextGraphRequest,
    availablePaths: string[],
    mentionPaths: string[],
  ): Promise<{ sourcePaths: string[]; diagnostics: ContextDiagnostics["graph"] }> {
    const graphOptions = request.graph;
    const limits = { ...DEFAULT_GRAPH_CONTEXT_LIMITS, ...(graphOptions?.limits ?? {}) };
    if (!this.graph || graphOptions?.enabled !== true) {
      return { sourcePaths: [], diagnostics: createDisabledGraphDiagnostics(limits) };
    }

    const discovery = await this.graph.discover({
      question: request.question,
      roots: graphRoots(request, mentionPaths),
      availablePaths,
      includeBacklinks: graphOptions.includeBacklinks,
      maxDepth: graphOptions.depth,
      limits,
    });
    return { sourcePaths: discovery.sourcePaths, diagnostics: discovery.diagnostics };
  }
}

function graphRoots(request: ContextGraphRequest, mentionPaths: string[]): GraphRoot[] {
  const roots: GraphRoot[] = [];
  const add = (path: string | undefined, role: ContextSourceRole): void => {
    if (!path || roots.some((root) => root.path === path)) return;
    roots.push({ path, role });
  };

  for (const path of mentionPaths) add(path, "mention");
  if (request.includeActiveFile) add(request.activeFilePath, "active");
  if (request.contextMode === "include" || request.graph?.expandFilteredContextThroughLinks) {
    for (const path of request.contextPaths) add(path, "attached");
  }
  return roots;
}
