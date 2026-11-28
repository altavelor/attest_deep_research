import { Tool } from "@core/agent";
import type { WebSourceSelectionDiagnostics } from "@core/diagnostics";
import type { ResearchModeWebParameters } from "@core/research";
import type { PageCache, SearchProvider } from "@application/ports";
import { DataSource, DataSourceDescriptor } from "@application/sources";
import { EvidenceRegistry } from "@application/sources";
import { WebSearchResearchTool } from "./WebSearchResearchTool";
import { WebFetchResearchTool } from "./WebFetchResearchTool";
import { WebFetchUrlTool } from "./WebFetchUrlTool";
import { WebFetchSectionTool } from "./WebFetchSectionTool";
import { WebPageMetadataTool } from "./WebPageMetadataTool";
import { FindInPagesTool, ReadPageRangeTool } from "./PageSearchTools";
import { AnswerArtifactRegistry } from "../media/AnswerArtifactRegistry";

export interface WebSourceOptions {
  provider: SearchProvider;
  evidence: EvidenceRegistry;
  artifacts?: AnswerArtifactRegistry;
  pageCache?: PageCache;
  available?: boolean;

  web?: ResearchModeWebParameters;

  onSourceSelection?: (diagnostics: WebSourceSelectionDiagnostics) => void;
}

export class WebSource implements DataSource {
  readonly descriptor: DataSourceDescriptor;
  private readonly provider: SearchProvider;
  private readonly evidence: EvidenceRegistry;
  private readonly artifacts?: AnswerArtifactRegistry;
  private readonly pageCache?: PageCache;
  private readonly web?: ResearchModeWebParameters;
  private readonly onSourceSelection?: (diagnostics: WebSourceSelectionDiagnostics) => void;

  constructor(options: WebSourceOptions) {
    this.provider = options.provider;
    this.evidence = options.evidence;
    this.artifacts = options.artifacts;
    this.pageCache = options.pageCache;
    this.web = options.web;
    this.onSourceSelection = options.onSourceSelection;
    this.descriptor = {
      id: "web",
      kind: "web",
      title: "Web research",
      available: options.available ?? true,
    };
  }

  tools(): Tool[] {
    const deps = {
      provider: this.provider,
      evidence: this.evidence,
      ...(this.artifacts ? { artifacts: this.artifacts } : {}),
      ...(this.pageCache ? { pageCache: this.pageCache } : {}),
      ...(this.web ? { web: this.web } : {}),
      ...(this.onSourceSelection ? { onSourceSelection: this.onSourceSelection } : {}),
    };
    const tools: Tool[] = [new WebSearchResearchTool(deps)];
    if (this.provider.fetchPage) {
      tools.push(
        new WebFetchResearchTool(deps),
        new WebFetchUrlTool(deps),
        new WebFetchSectionTool(deps),
      );
      if (this.pageCache) {
        tools.push(
          new FindInPagesTool({ evidence: this.evidence, pageCache: this.pageCache }),
          new ReadPageRangeTool({ evidence: this.evidence, pageCache: this.pageCache }),
        );
      }
    }
    if (this.provider.fetchMetadata) {
      tools.push(new WebPageMetadataTool({ provider: this.provider }));
    }
    return tools;
  }
}
